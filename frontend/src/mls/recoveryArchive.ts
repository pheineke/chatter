/**
 * Recovery-code encrypted history archive — the "I lost every device" path.
 *
 * Everyday multi-device linking hands history over device-to-device and
 * leaves no lasting secret anywhere (historyTransfer.ts). That covers every
 * case except having no device left to hand it over from, which is what this
 * is for.
 *
 * The tradeoff is real and worth stating plainly: recovering history with
 * nothing left necessarily requires a secret that outlives your devices. So
 * the archive is encrypted under a key derived from a recovery code shown
 * once at sign-up and never sent to the server. Forward secrecy still holds
 * for MLS traffic; it is given up for the archive, and only for the archive.
 * A user who would rather not have a decryptable copy of their history stored
 * can delete it outright.
 */
import * as api from './api'
import * as store from './storage'

/** Messages per archived chunk — same reasoning as the transfer batch size:
 * small enough to encrypt without blocking the tab, comfortably inside the
 * server's per-payload cap. */
const ENTRIES_PER_CHUNK = 200

/** Alphabet for recovery codes.
 *
 * Crockford-style: no I, L, O or U, so the character pairs people most often
 * confuse when copying by hand (1/I/l, 0/O) can't occur, and nothing spells
 * anything unfortunate. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_GROUPS = 8
const CHARS_PER_GROUP = 5

/** Known plaintext encrypted under the derived key, so a client can tell a
 * mistyped code from a corrupt archive before trying to restore anything. */
const VERIFIER_PLAINTEXT = 'chatter-recovery-v1'

const PBKDF2_ITERATIONS = 210_000

interface ArchivePayload {
  v: 1
  entries: { c: string; p: string; t: string }[]
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/**
 * Generate a recovery code: 40 characters from a 32-symbol alphabet, so 200
 * bits of entropy, formatted in groups for transcription.
 *
 * Entropy this high is why the KDF's iteration count is a formality rather
 * than the thing standing between an attacker and the archive — brute force
 * is hopeless regardless. It also means the code cannot be remembered, only
 * stored, which is the honest bargain and why the UI tells people to save it.
 */
export function generateRecoveryCode(): string {
  const raw = new Uint8Array(CODE_GROUPS * CHARS_PER_GROUP)
  crypto.getRandomValues(raw)
  const chars = Array.from(raw, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  const groups: string[] = []
  for (let i = 0; i < CODE_GROUPS; i++) {
    groups.push(chars.slice(i * CHARS_PER_GROUP, (i + 1) * CHARS_PER_GROUP).join(''))
  }
  return groups.join('-')
}

/** Accept a code however the user typed it: any case, any separators. */
function canonicaliseCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '')
}

async function deriveArchiveKey(code: string, saltB64: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(canonicaliseCode(code)),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: base64ToBuf(saltB64),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    // Non-extractable: it gets stored in IndexedDB so archiving can continue
    // without the code, and this way page script can use it but never read it
    // out.
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptJson(key: CryptoKey, value: unknown): Promise<{ ciphertext: string; nonce: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return { ciphertext: bufToBase64(cipher), nonce: bufToBase64(iv.buffer) }
}

async function decryptJson<T>(key: CryptoKey, ciphertext: string, nonce: string): Promise<T | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBuf(nonce) },
      key,
      base64ToBuf(ciphertext),
    )
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    // Wrong key or tampered data — indistinguishable, and both mean "can't
    // use this".
    return null
  }
}

/**
 * Create a recovery code and register its parameters with the server.
 *
 * Returns the code exactly once: it isn't stored locally or remotely, so if
 * the user doesn't save it at this point it is genuinely unrecoverable, and
 * so is any history that outlives their devices.
 */
export async function setUpRecoveryCode(userId: string): Promise<string> {
  const code = generateRecoveryCode()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltB64 = bufToBase64(salt.buffer)
  const key = await deriveArchiveKey(code, saltB64)
  const verifier = await encryptJson(key, VERIFIER_PLAINTEXT)

  await api.putRecoveryArchiveMeta({
    kdfSalt: saltB64,
    verifierCiphertext: verifier.ciphertext,
    verifierNonce: verifier.nonce,
  })
  // Keep the derived key so the archive can be topped up as messages arrive.
  // Without this it would only ever hold what existed at this moment, which
  // for a new account is nothing at all.
  await store.saveArchiveKey(userId, key)
  return code
}

/** True if the code opens this account's archive. Cheap check against the
 * verifier, so a typo is reported as a typo rather than as a failed restore. */
export async function checkRecoveryCode(code: string): Promise<boolean> {
  const meta = await api.fetchRecoveryArchiveMeta()
  if (!meta) return false
  const key = await deriveArchiveKey(code, meta.kdfSalt)
  const value = await decryptJson<string>(key, meta.verifierCiphertext, meta.verifierNonce)
  return value === VERIFIER_PLAINTEXT
}

/**
 * Bring the archive up to date with this device's readable history.
 *
 * Incremental: picks up from the newest entry already archived, so a routine
 * call costs one chunk rather than re-encrypting everything. Uses the stored
 * key, so it can run on every load without the user re-entering their code —
 * which is the whole point, since an archive that only captured the moment it
 * was created would be permanently empty.
 *
 * Chunk keys name the range they cover, so two devices archiving the same
 * messages converge on one row instead of duplicating.
 *
 * Does nothing when no recovery code has been set up on this device.
 */
export async function archiveHistory(userId: string): Promise<number> {
  const key = await store.loadArchiveKey(userId)
  if (!key) return 0 // no recovery code set up on this device

  let cursor = await store.loadArchivedThrough(userId)
  let archived = 0

  for (;;) {
    const entries = await store.plaintextNewerThan(cursor, ENTRIES_PER_CHUNK)
    if (entries.length === 0) break

    const payload: ArchivePayload = {
      v: 1,
      entries: entries.map((e) => ({
        c: e.ciphertext,
        p: e.plaintext,
        t: e.createdAt.toISOString(),
      })),
    }
    const { ciphertext, nonce } = await encryptJson(key, payload)
    // The oldest entry's timestamp names the range. Deterministic, so two
    // devices archiving the same messages upsert one row instead of two, and
    // it sorts chronologically, which the paged restore relies on.
    await api.putRecoveryArchiveChunk({
      chunkKey: entries[0].createdAt.toISOString(),
      ciphertext,
      nonce,
    })
    archived += entries.length
    cursor = entries[entries.length - 1].createdAt
    await store.saveArchivedThrough(userId, cursor)
  }
  return archived
}


/**
 * Restore history from the archive onto this device.
 *
 * Returns the number of messages recovered, or null if the code is wrong —
 * distinguished so the UI can say "check your code" rather than implying the
 * archive is broken.
 */
export async function restoreFromArchive(userId: string, code: string): Promise<number | null> {
  const meta = await api.fetchRecoveryArchiveMeta()
  if (!meta) return 0
  const key = await deriveArchiveKey(code, meta.kdfSalt)
  if ((await decryptJson<string>(key, meta.verifierCiphertext, meta.verifierNonce)) !== VERIFIER_PLAINTEXT) {
    return null
  }

  let sinceKey: string | null = null
  let restored = 0

  for (;;) {
    const chunks = await api.fetchRecoveryArchiveChunks(sinceKey)
    if (chunks.length === 0) break

    for (const chunk of chunks) {
      const payload = await decryptJson<ArchivePayload>(key, chunk.ciphertext, chunk.nonce)
      if (payload === null || payload.v !== 1) {
        // The verifier already passed, so the key is right — this particular
        // chunk is damaged. Skip it and keep going rather than abandoning the
        // rest of an otherwise good archive.
        console.warn('[MLS] skipping unreadable archive chunk', chunk.chunkKey)
        continue
      }
      await store.importPlaintext(
        payload.entries.map((e) => ({
          ciphertext: e.c,
          plaintext: e.p,
          createdAt: new Date(e.t),
        })),
      )
      restored += payload.entries.length
    }
    sinceKey = chunks[chunks.length - 1].chunkKey
  }

  // This device now holds the key, so it can keep the archive current from
  // here on without asking for the code again.
  await store.saveArchiveKey(userId, key)
  return restored
}

/** Whether this account has an archive at all, for showing the restore
 * option only when it can do something. */
export async function hasRecoveryArchive(): Promise<boolean> {
  return (await api.fetchRecoveryArchiveMeta()) !== null
}

/** Archive parameters and size, for Settings to report what's stored. */
export async function fetchRecoveryArchiveMeta() {
  return api.fetchRecoveryArchiveMeta()
}

/** Forget how far this device has archived, so the next pass re-uploads
 * everything. Needed after regenerating a code: the server drops the old
 * chunks (they're unreadable under the new key), so a progress marker
 * pointing past them would leave the archive permanently short of history
 * this device is holding. */
export async function resetArchiveProgress(userId: string): Promise<void> {
  await store.clearArchivedThrough(userId)
}

/** Delete the archive — opting out of the tradeoff entirely. Also drops the
 * local key, so nothing is left pointing at data that no longer exists. */
export async function deleteRecoveryArchive(userId: string): Promise<void> {
  await api.deleteRecoveryArchive()
  await store.clearArchiveKey(userId)
}
