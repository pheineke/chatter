/**
 * E2EE Crypto primitives
 *
 * Algorithm choices (Web Crypto API — no external library needed):
 *   Key exchange:  ECDH P-256  (universally supported in all modern browsers)
 *   Symmetric enc: AES-256-GCM (96-bit nonce, 128-bit auth tag)
 *   Fingerprint:   SHA-256 of the raw public key bytes → first 32 hex chars
 *
 * Key serialisation:
 *   Public key  → SPKI  bytes → base64
 *   Private key → PKCS8 bytes → base64   (stored ONLY in IndexedDB / export)
 *
 * The server never sees private key material.  During the QR-login flow the
 * private key is encrypted with AES-GCM using a secret derived from
 *   ECDH(approver's E2EE private key, new device's ephemeral public key)
 * so it is safe to transmit through the server.
 */

const ALGO = { name: 'ECDH', namedCurve: 'P-256' } as const
const ENC_ALGO = 'AES-GCM'
const KEY_LEN = 256 // bits

// ─── Key generation ────────────────────────────────────────────────────────

/** Generate a fresh ECDH P-256 keypair. */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALGO, true /* extractable */, ['deriveKey', 'deriveBits'])
}

/** Generate a one-shot ephemeral keypair (used by the new device in QR login). */
export const generateEphemeralKeyPair = generateKeyPair

// ─── Serialisation helpers ─────────────────────────────────────────────────

/** Export a public key to URL-safe base64 (SPKI format). */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const buf = await crypto.subtle.exportKey('spki', key)
  return bufToBase64(buf)
}

/** Export a private key to URL-safe base64 (PKCS#8 format). */
export async function exportPrivateKey(key: CryptoKey): Promise<string> {
  const buf = await crypto.subtle.exportKey('pkcs8', key)
  return bufToBase64(buf)
}

/** Import a public key from base64 SPKI. */
export async function importPublicKey(b64: string): Promise<CryptoKey> {
  const buf = base64ToBuf(b64)
  return crypto.subtle.importKey('spki', buf, ALGO, true, [])
}

/** Import a private key from base64 PKCS#8. */
export async function importPrivateKey(b64: string): Promise<CryptoKey> {
  const buf = base64ToBuf(b64)
  return crypto.subtle.importKey('pkcs8', buf, ALGO, true, ['deriveKey', 'deriveBits'])
}

// ─── Fingerprint ──────────────────────────────────────────────────────────

/**
 * Compute a human-readable fingerprint of a public key.
 * Returns the first 32 hex chars of SHA-256(SPKI bytes), grouped in pairs
 * (e.g. "A1 B2 C3 D4 E5 F6 07 08 09 0A 0B 0C 0D 0E 0F 10").
 */
export async function keyFingerprint(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', publicKey)
  const hash = await crypto.subtle.digest('SHA-256', spki)
  const hex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .slice(0, 16)
    .join(' ')
  return hex
}

// ─── Key agreement ────────────────────────────────────────────────────────

/**
 * Derive a shared AES-256-GCM key from an ECDH exchange.
 *
 * @param myPrivateKey  This device's ECDH private key
 * @param theirPublicKey  The other party's ECDH public key
 */
export async function deriveSharedKey(
  myPrivateKey: CryptoKey,
  theirPublicKey: CryptoKey,
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    { name: ENC_ALGO, length: KEY_LEN },
    false /* non-extractable — stays in memory */,
    ['encrypt', 'decrypt'],
  )
}

// ─── Message encryption / decryption ────────────────────────────────────

export interface EncryptedPayload {
  /** AES-GCM ciphertext, base64-encoded. */
  ciphertext: string
  /** 12-byte AES-GCM nonce (IV), base64-encoded. */
  nonce: string
}

/** Encrypt a UTF-8 plaintext string with AES-256-GCM. */
export async function encryptMessage(
  sharedKey: CryptoKey,
  plaintext: string,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const cipherBuf = await crypto.subtle.encrypt(
    { name: ENC_ALGO, iv },
    sharedKey,
    encoded,
  )
  return {
    ciphertext: bufToBase64(cipherBuf),
    nonce: bufToBase64(iv.buffer),
  }
}

/** Decrypt an AES-256-GCM ciphertext. Returns null on auth-tag failure. */
export async function decryptMessage(
  sharedKey: CryptoKey,
  ciphertext: string,
  nonce: string,
): Promise<string | null> {
  try {
    const iv = base64ToBuf(nonce)
    const cipher = base64ToBuf(ciphertext)
    const plainBuf = await crypto.subtle.decrypt(
      { name: ENC_ALGO, iv },
      sharedKey,
      cipher,
    )
    return new TextDecoder().decode(plainBuf)
  } catch {
    return null
  }
}

// ─── QR key transfer – encrypt private key for new device ────────────────

/**
 * Encrypt the user's ECDH private key for transfer to a new device.
 *
 * Called by the TRUSTED device (phone) after scanning the QR code.
 *
 * @param myPrivateKey  Trusted device's own E2EE private key (used for ECDH)
 * @param deviceEphemeralPublicKey  New device's ephemeral public key (from QR)
 * @param privateKeyToTransfer  The private key bytes to encrypt and send
 */
export async function encryptPrivateKeyForTransfer(
  myPrivateKey: CryptoKey,
  deviceEphemeralPublicKey: CryptoKey,
  privateKeyToTransfer: CryptoKey,
): Promise<EncryptedPayload> {
  const transferKey = await deriveSharedKey(myPrivateKey, deviceEphemeralPublicKey)
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKeyToTransfer)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipherBuf = await crypto.subtle.encrypt(
    { name: ENC_ALGO, iv },
    transferKey,
    pkcs8,
  )
  return {
    ciphertext: bufToBase64(cipherBuf),
    nonce: bufToBase64(iv.buffer),
  }
}

/**
 * Decrypt the private key received from the trusted device.
 *
 * Called by the NEW device after the QR session is approved.
 *
 * @param myEphemeralPrivateKey  New device's ephemeral private key
 * @param approverPublicKey      Trusted device's E2EE public key (from poll response)
 * @param encryptedPrivateKey    base64 ciphertext from the poll response
 * @param nonce                  base64 nonce from the poll response
 */
export async function decryptPrivateKeyFromTransfer(
  myEphemeralPrivateKey: CryptoKey,
  approverPublicKey: CryptoKey,
  encryptedPrivateKey: string,
  nonce: string,
): Promise<CryptoKey | null> {
  try {
    const transferKey = await deriveSharedKey(myEphemeralPrivateKey, approverPublicKey)
    const iv = base64ToBuf(nonce)
    const cipher = base64ToBuf(encryptedPrivateKey)
    const pkcs8 = await crypto.subtle.decrypt({ name: ENC_ALGO, iv }, transferKey, cipher)
    return crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      ALGO,
      true,
      ['deriveKey', 'deriveBits'],
    )
  } catch {
    return null
  }
}

// ─── Key backup (export) ──────────────────────────────────────────────────

export interface KeyBackup {
  /** "chatter-e2ee-backup-v1" — used to validate the file on import */
  version: string
  publicKey: string  // base64 SPKI
  privateKey: string // base64 PKCS#8
  fingerprint: string
  exportedAt: string // ISO timestamp
}

export async function exportKeyBackup(pair: CryptoKeyPair): Promise<KeyBackup> {
  const [pub, priv] = await Promise.all([
    exportPublicKey(pair.publicKey),
    exportPrivateKey(pair.privateKey),
  ])
  return {
    version: 'chatter-e2ee-backup-v1',
    publicKey: pub,
    privateKey: priv,
    fingerprint: await keyFingerprint(pair.publicKey),
    exportedAt: new Date().toISOString(),
  }
}

export async function importKeyBackup(backup: KeyBackup): Promise<CryptoKeyPair> {
  if (backup.version !== 'chatter-e2ee-backup-v1') {
    throw new Error('Unsupported backup version')
  }
  const [publicKey, privateKey] = await Promise.all([
    importPublicKey(backup.publicKey),
    importPrivateKey(backup.privateKey),
  ])
  return { publicKey, privateKey }
}

// ─── Byte ↔ Base64 helpers ─────────────────────────────────────────────────

export function bufToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

export function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}
