import { describe, it, expect, vi, beforeEach } from 'vitest'

// Server and IndexedDB stubbed; WebCrypto left real so the ECDH/AES round
// trip is genuinely exercised rather than mocked away.

const api = vi.hoisted(() => ({
  requestHistory: vi.fn(),
  fetchHistoryRequests: vi.fn(),
  deleteHistoryRequest: vi.fn(),
  uploadHistoryBundle: vi.fn(),
  fetchHistoryBundles: vi.fn(),
  consumeHistoryBundle: vi.fn(),
}))

const store = vi.hoisted(() => ({
  saveTransferKeyPair: vi.fn(),
  loadTransferKeyPair: vi.fn(),
  clearTransferKeyPair: vi.fn(),
  plaintextOlderThan: vi.fn(),
  importPlaintext: vi.fn(),
}))

vi.mock('./api', () => api)
vi.mock('./storage', () => store)

import { requestHistory, servePendingHistoryRequests, collectHistory } from './historyTransfer'

function entriesNewestFirst(count: number, startIso = '2026-06-01T00:00:00Z') {
  const base = new Date(startIso).getTime()
  return Array.from({ length: count }, (_, i) => ({
    ciphertext: `c${i}`,
    plaintext: `message ${i}`,
    createdAt: new Date(base - i * 60_000),
  }))
}

/** Raise a request the way a new device would, and return the published key. */
async function publishedRequest(deviceId = 'new-device') {
  await requestHistory('user-1', deviceId)
  const [, publicKey] = api.requestHistory.mock.calls.at(-1)!
  const keys = store.saveTransferKeyPair.mock.calls.at(-1)!
  return { publicKey, privateKey: keys[1], storedPublicKey: keys[2] }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchHistoryRequests.mockResolvedValue([])
  api.fetchHistoryBundles.mockResolvedValue([])
  store.plaintextOlderThan.mockResolvedValue([])
})

describe('requestHistory', () => {
  it('publishes a public key and keeps the private half locally', async () => {
    const { publicKey, privateKey, storedPublicKey } = await publishedRequest()
    expect(publicKey).toBeTruthy()
    expect(privateKey).toBeTruthy()
    // Both halves are stored: re-announcing between batches has to reuse the
    // same key, and WebCrypto can't recover a public key from PKCS#8.
    expect(storedPublicKey).toBe(publicKey)
  })
})

describe('servePendingHistoryRequests', () => {
  it('ignores its own device', async () => {
    api.fetchHistoryRequests.mockResolvedValue([
      { id: 'r1', deviceId: 'me', publicKey: 'K', syncedBefore: null },
    ])
    await expect(servePendingHistoryRequests('me')).resolves.toBe(0)
    expect(api.uploadHistoryBundle).not.toHaveBeenCalled()
  })

  it('sends newest messages first', async () => {
    const { publicKey } = await publishedRequest('other')
    api.fetchHistoryRequests.mockResolvedValue([
      { id: 'r1', deviceId: 'other', publicKey, syncedBefore: null },
    ])
    const all = entriesNewestFirst(3)
    store.plaintextOlderThan.mockImplementation(async (before: Date | null, limit: number) => {
      const pool = before === null ? all : all.filter((e) => e.createdAt < before)
      return pool.slice(0, limit)
    })

    await servePendingHistoryRequests('me')

    // First query asks from the newest end, which is what makes recent
    // conversation appear on the new device almost immediately.
    expect(store.plaintextOlderThan.mock.calls[0][0]).toBeNull()
    expect(api.uploadHistoryBundle).toHaveBeenCalled()
  })

  it('resumes from the requesting device’s cursor', async () => {
    const { publicKey } = await publishedRequest('other')
    const cursor = new Date('2026-03-03T00:00:00Z')
    api.fetchHistoryRequests.mockResolvedValue([
      { id: 'r1', deviceId: 'other', publicKey, syncedBefore: cursor },
    ])
    store.plaintextOlderThan.mockResolvedValue([
      { ciphertext: 'c', plaintext: 'p', createdAt: new Date('2026-02-02T00:00:00Z') },
    ])

    await servePendingHistoryRequests('me')
    // Everything newer than the cursor is already on that device.
    expect(store.plaintextOlderThan.mock.calls[0][0]).toEqual(cursor)
  })

  it('does not retire a request when it holds no history itself', async () => {
    // A freshly-linked device must not tell another "you're done" — the
    // device that actually holds history may not have had a turn yet.
    api.fetchHistoryRequests.mockResolvedValue([
      { id: 'r1', deviceId: 'other', publicKey: 'K', syncedBefore: new Date() },
    ])
    store.plaintextOlderThan.mockResolvedValue([])

    await servePendingHistoryRequests('empty-device')
    expect(api.deleteHistoryRequest).not.toHaveBeenCalled()
  })

  it('retires the request once it has nothing older left to send', async () => {
    const cursor = new Date('2026-01-01T00:00:00Z')
    api.fetchHistoryRequests.mockResolvedValue([
      { id: 'r1', deviceId: 'other', publicKey: 'K', syncedBefore: cursor },
    ])
    store.plaintextOlderThan.mockImplementation(async (before: Date | null) =>
      // Holds history, but none of it older than the cursor.
      before === null ? [{ ciphertext: 'c', plaintext: 'p', createdAt: new Date('2026-05-05T00:00:00Z') }] : [],
    )

    await servePendingHistoryRequests('me')
    expect(api.deleteHistoryRequest).toHaveBeenCalledWith('other')
  })

  it('one unusable request does not stop the others being served', async () => {
    const { publicKey } = await publishedRequest('good')
    api.fetchHistoryRequests.mockResolvedValue([
      { id: 'r1', deviceId: 'broken', publicKey: 'not-a-key', syncedBefore: null },
      { id: 'r2', deviceId: 'good', publicKey, syncedBefore: null },
    ])
    store.plaintextOlderThan.mockImplementation(async (_before: Date | null, limit: number) =>
      entriesNewestFirst(1).slice(0, limit),
    )

    await servePendingHistoryRequests('me')
    const targets = api.uploadHistoryBundle.mock.calls.map((c) => c[0].targetDeviceId)
    expect(targets).toContain('good')
  })
})

describe('collectHistory', () => {
  it('does nothing when this device never asked', async () => {
    store.loadTransferKeyPair.mockResolvedValue(null)
    await expect(collectHistory('user-1', 'dev')).resolves.toBe(0)
  })

  it('clears the transfer key once the request has been retired', async () => {
    store.loadTransferKeyPair.mockResolvedValue({ privateKey: 'x', publicKey: 'y' })
    api.fetchHistoryBundles.mockResolvedValue([])
    api.fetchHistoryRequests.mockResolvedValue([]) // retired by a serving device

    await collectHistory('user-1', 'dev')
    expect(store.clearTransferKeyPair).toHaveBeenCalledWith('user-1')
  })

  it('keeps the key while the transfer is still outstanding', async () => {
    store.loadTransferKeyPair.mockResolvedValue({ privateKey: 'x', publicKey: 'y' })
    api.fetchHistoryBundles.mockResolvedValue([])
    api.fetchHistoryRequests.mockResolvedValue([
      { id: 'r1', deviceId: 'dev', publicKey: 'y', syncedBefore: null },
    ])

    await collectHistory('user-1', 'dev')
    expect(store.clearTransferKeyPair).not.toHaveBeenCalled()
  })

  it('imports a real bundle and moves the cursor back', async () => {
    // Full round trip: one device serves, the other collects.
    const { publicKey } = await publishedRequest('receiver')
    const storedPair = store.saveTransferKeyPair.mock.calls.at(-1)!
    api.fetchHistoryRequests.mockResolvedValue([
      { id: 'r1', deviceId: 'receiver', publicKey, syncedBefore: null },
    ])
    const all = entriesNewestFirst(2)
    store.plaintextOlderThan.mockImplementation(async (before: Date | null, limit: number) => {
      const pool = before === null ? all : all.filter((e) => e.createdAt < before)
      return pool.slice(0, limit)
    })
    await servePendingHistoryRequests('sender')

    const sent = api.uploadHistoryBundle.mock.calls[0][0]
    api.fetchHistoryBundles.mockResolvedValue([
      {
        id: 'b1',
        senderDeviceId: sent.senderDeviceId,
        senderPublicKey: sent.senderPublicKey,
        ciphertext: sent.ciphertext,
        nonce: sent.nonce,
      },
    ])
    store.loadTransferKeyPair.mockResolvedValue({
      privateKey: storedPair[1],
      publicKey: storedPair[2],
    })
    api.fetchHistoryRequests.mockResolvedValue([
      { id: 'r1', deviceId: 'receiver', publicKey, syncedBefore: null },
    ])

    const imported = await collectHistory('user-1', 'receiver')
    expect(imported).toBe(2)

    const [entries] = store.importPlaintext.mock.calls[0]
    expect(entries[0].plaintext).toBe('message 0')
    // Original timestamps survive the transfer; ordering and resumption both
    // depend on them, and stamping "now" on import would flatten them.
    expect(entries[0].createdAt.toISOString()).toBe(all[0].createdAt.toISOString())

    // Bundle consumed, and the cursor re-announced at the oldest thing seen.
    expect(api.consumeHistoryBundle).toHaveBeenCalledWith('b1')
    const [, , announcedCursor] = api.requestHistory.mock.calls.at(-1)!
    expect(announcedCursor).toEqual(all[all.length - 1].createdAt)
  })

  it('leaves an unauthentic bundle in place rather than discarding it', async () => {
    // A genuine local keypair, so the failure under test is the bundle
    // failing to authenticate rather than our own key being unreadable.
    await publishedRequest('dev')
    const pair = store.saveTransferKeyPair.mock.calls.at(-1)!
    store.loadTransferKeyPair.mockResolvedValue({ privateKey: pair[1], publicKey: pair[2] })

    // Encrypted by someone else — or corrupted in transit. Either way this
    // device cannot open it.
    const stranger = await publishedRequest('stranger')
    api.fetchHistoryBundles.mockResolvedValue([
      {
        id: 'b1',
        senderDeviceId: 'other',
        senderPublicKey: stranger.publicKey,
        ciphertext: btoa('not really ciphertext'),
        nonce: btoa('123456789012'),
      },
    ])
    api.fetchHistoryRequests.mockResolvedValue([])

    await collectHistory('user-1', 'dev')
    // It's the only copy of that history that will ever be offered, so a
    // failure is worth another attempt rather than deletion.
    expect(api.consumeHistoryBundle).not.toHaveBeenCalled()
    expect(store.importPlaintext).not.toHaveBeenCalled()
  })
})
