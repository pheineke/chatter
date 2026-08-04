import { describe, it, expect, vi, beforeEach } from 'vitest'

// The server and IndexedDB are stubbed so these tests exercise the crypto and
// the control flow rather than transport. WebCrypto is left real — jsdom
// exposes the same SubtleCrypto the browser does, and several of these tests
// exist to show the cryptography genuinely round-trips rather than that the
// right functions were called.

const api = vi.hoisted(() => ({
  putRecoveryArchiveMeta: vi.fn(),
  fetchRecoveryArchiveMeta: vi.fn(),
  putRecoveryArchiveChunk: vi.fn(),
  fetchRecoveryArchiveChunks: vi.fn(),
  deleteRecoveryArchive: vi.fn(),
}))

const store = vi.hoisted(() => ({
  saveArchiveKey: vi.fn(),
  loadArchiveKey: vi.fn(),
  loadArchivedThrough: vi.fn(),
  saveArchivedThrough: vi.fn(),
  clearArchiveKey: vi.fn(),
  clearArchivedThrough: vi.fn(),
  plaintextNewerThan: vi.fn(),
  importPlaintext: vi.fn(),
}))

vi.mock('./api', () => api)
vi.mock('./storage', () => store)

import {
  generateRecoveryCode,
  setUpRecoveryCode,
  checkRecoveryCode,
  archiveHistory,
  restoreFromArchive,
} from './recoveryArchive'

/** Run setup and return both the code and the meta the server would now hold,
 * wired up so later calls see the same salt and verifier. */
async function setUpAndWire(userId = 'user-1') {
  const code = await setUpRecoveryCode(userId)
  const [payload] = api.putRecoveryArchiveMeta.mock.calls.at(-1)!
  api.fetchRecoveryArchiveMeta.mockResolvedValue({
    kdfSalt: payload.kdfSalt,
    verifierCiphertext: payload.verifierCiphertext,
    verifierNonce: payload.verifierNonce,
    chunkCount: 0,
  })
  // The key setUpRecoveryCode derived and handed to storage.
  const key = store.saveArchiveKey.mock.calls.at(-1)![1]
  store.loadArchiveKey.mockResolvedValue(key)
  return { code, key }
}

const WRONG_CODE = 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF-GGGGG-HHHHH'

beforeEach(() => {
  vi.clearAllMocks()
  store.loadArchivedThrough.mockResolvedValue(null)
  store.plaintextNewerThan.mockResolvedValue([])
  api.fetchRecoveryArchiveChunks.mockResolvedValue([])
})

describe('generateRecoveryCode', () => {
  it('produces 8 groups of 5 characters', () => {
    expect(generateRecoveryCode()).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){7}$/)
  })

  it('never emits characters that are easy to mistranscribe', () => {
    // I, L, O and U are excluded so 1-vs-I and 0-vs-O can't be confused when
    // the code is copied by hand, which is the only way it's ever stored.
    const codes = Array.from({ length: 40 }, () => generateRecoveryCode()).join('')
    expect(codes).not.toMatch(/[ILOU]/)
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateRecoveryCode()))
    expect(seen.size).toBe(50)
  })
})

describe('setUpRecoveryCode', () => {
  it('registers a salt and verifier with the server', async () => {
    await setUpAndWire()
    const [payload] = api.putRecoveryArchiveMeta.mock.calls[0]
    expect(payload.kdfSalt).toBeTruthy()
    expect(payload.verifierCiphertext).toBeTruthy()
    expect(payload.verifierNonce).toBeTruthy()
  })

  it('keeps the derived key locally', async () => {
    // Without this the archive can only be written at setup, when a new
    // account has nothing to write — which left it permanently empty.
    await setUpAndWire()
    expect(store.saveArchiveKey).toHaveBeenCalledWith('user-1', expect.anything())
  })

  it('never sends the code itself anywhere', async () => {
    const { code } = await setUpAndWire()
    const sent = JSON.stringify(api.putRecoveryArchiveMeta.mock.calls)
    expect(sent).not.toContain(code)
    expect(sent).not.toContain(code.replace(/-/g, ''))
  })
})

describe('checkRecoveryCode', () => {
  it('accepts the real code and rejects a wrong one', async () => {
    const { code } = await setUpAndWire()
    await expect(checkRecoveryCode(code)).resolves.toBe(true)
    await expect(checkRecoveryCode(WRONG_CODE)).resolves.toBe(false)
  })

  it('accepts the code however it was typed', async () => {
    const { code } = await setUpAndWire()
    // Retyped from paper: case and separators must not matter.
    await expect(checkRecoveryCode(code.toLowerCase())).resolves.toBe(true)
    await expect(checkRecoveryCode(code.replace(/-/g, ' '))).resolves.toBe(true)
    await expect(checkRecoveryCode(code.replace(/-/g, ''))).resolves.toBe(true)
  })

  it('is false when the account has no archive', async () => {
    api.fetchRecoveryArchiveMeta.mockResolvedValue(null)
    await expect(checkRecoveryCode('ANY')).resolves.toBe(false)
  })
})

describe('archiveHistory', () => {
  it('does nothing without a key on this device', async () => {
    store.loadArchiveKey.mockResolvedValue(null)
    await expect(archiveHistory('user-1')).resolves.toBe(0)
    expect(api.putRecoveryArchiveChunk).not.toHaveBeenCalled()
  })

  it('uploads new messages and advances the progress marker', async () => {
    await setUpAndWire()
    const entries = [
      { ciphertext: 'c1', plaintext: 'one', createdAt: new Date('2026-01-01T00:00:00Z') },
      { ciphertext: 'c2', plaintext: 'two', createdAt: new Date('2026-01-02T00:00:00Z') },
    ]
    store.plaintextNewerThan.mockResolvedValueOnce(entries).mockResolvedValue([])

    await expect(archiveHistory('user-1')).resolves.toBe(2)

    const [chunk] = api.putRecoveryArchiveChunk.mock.calls[0]
    // Named by the range it covers, so another device archiving the same
    // messages upserts one row instead of duplicating.
    expect(chunk.chunkKey).toBe('2026-01-01T00:00:00.000Z')
    expect(store.saveArchivedThrough).toHaveBeenCalledWith('user-1', entries[1].createdAt)
  })

  it('uploads ciphertext, not readable messages', async () => {
    await setUpAndWire()
    store.plaintextNewerThan
      .mockResolvedValueOnce([
        { ciphertext: 'c1', plaintext: 'the secret words', createdAt: new Date('2026-01-01T00:00:00Z') },
      ])
      .mockResolvedValue([])

    await archiveHistory('user-1')
    const [chunk] = api.putRecoveryArchiveChunk.mock.calls[0]
    expect(chunk.ciphertext).not.toContain('the secret words')
    expect(atob(chunk.ciphertext)).not.toContain('the secret words')
  })

  it('resumes from the stored marker rather than re-uploading everything', async () => {
    await setUpAndWire()
    const marker = new Date('2026-05-05T00:00:00Z')
    store.loadArchivedThrough.mockResolvedValue(marker)

    await archiveHistory('user-1')
    expect(store.plaintextNewerThan).toHaveBeenCalledWith(marker, expect.any(Number))
  })
})

describe('restoreFromArchive', () => {
  it('round-trips what archiveHistory produced', async () => {
    const { code } = await setUpAndWire()

    store.plaintextNewerThan
      .mockResolvedValueOnce([
        { ciphertext: 'c1', plaintext: 'hello', createdAt: new Date('2026-01-01T00:00:00Z') },
      ])
      .mockResolvedValue([])
    await archiveHistory('user-1')

    // Feed the real ciphertext back as if the server were returning it.
    const written = api.putRecoveryArchiveChunk.mock.calls[0][0]
    api.fetchRecoveryArchiveChunks
      .mockResolvedValueOnce([
        { id: 'b1', chunkKey: written.chunkKey, ciphertext: written.ciphertext, nonce: written.nonce },
      ])
      .mockResolvedValue([])

    await expect(restoreFromArchive('user-1', code)).resolves.toBe(1)

    const [imported] = store.importPlaintext.mock.calls[0]
    expect(imported[0].plaintext).toBe('hello')
    expect(imported[0].ciphertext).toBe('c1')
    // Timestamps survive: ordering and the resume cursor both depend on them.
    expect(imported[0].createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('keeps the key afterwards so the device keeps archiving', async () => {
    const { code } = await setUpAndWire()
    // Ignore the save from setup; we care about the one restore performs.
    store.saveArchiveKey.mockClear()

    await restoreFromArchive('user-1', code)

    // A restored device holds the key from here on, so it can keep the
    // archive current without ever asking for the code again.
    expect(store.saveArchiveKey).toHaveBeenCalledWith('user-1', expect.anything())
  })

  it('returns null for a wrong code, so the UI can say "check your code"', async () => {
    await setUpAndWire()
    await expect(restoreFromArchive('user-1', WRONG_CODE)).resolves.toBeNull()
    // Distinguished from a failed restore on purpose: a null must not look
    // like an empty archive, or the user is told the wrong thing.
    expect(store.importPlaintext).not.toHaveBeenCalled()
  })

  it('returns 0 when the account has no archive at all', async () => {
    api.fetchRecoveryArchiveMeta.mockResolvedValue(null)
    await expect(restoreFromArchive('user-1', 'ANY')).resolves.toBe(0)
  })

  it('skips a damaged chunk instead of abandoning the whole restore', async () => {
    const { code } = await setUpAndWire()

    store.plaintextNewerThan
      .mockResolvedValueOnce([
        { ciphertext: 'c1', plaintext: 'good', createdAt: new Date('2026-01-01T00:00:00Z') },
      ])
      .mockResolvedValue([])
    await archiveHistory('user-1')
    const good = api.putRecoveryArchiveChunk.mock.calls[0][0]

    api.fetchRecoveryArchiveChunks
      .mockResolvedValueOnce([
        { id: 'bad', chunkKey: '2025-01-01T00:00:00.000Z', ciphertext: btoa('rubbish'), nonce: btoa('123456789012') },
        { id: 'ok', chunkKey: good.chunkKey, ciphertext: good.ciphertext, nonce: good.nonce },
      ])
      .mockResolvedValue([])

    // The verifier passed, so the key is right and a bad chunk is damage —
    // worth skipping rather than throwing away an otherwise good archive.
    await expect(restoreFromArchive('user-1', code)).resolves.toBe(1)
  })
})
