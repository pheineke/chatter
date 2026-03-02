/**
 * IndexedDB key store — persists the user's ECDH keypair across sessions.
 *
 * Uses Dexie for a clean async API.  The keypair is stored in PKCS#8 / SPKI
 * format so it survives serialisation.  Raw CryptoKey objects cannot be
 * cloned into IndexedDB.
 *
 * Layout:
 *   DB "chatter-e2ee"  (version 1)
 *   └─ keyPairs  { userId (pk), publicKey: string, privateKey: string, fingerprint: string, createdAt: Date }
 */

import Dexie, { type Table } from 'dexie'
import {
  exportPublicKey,
  exportPrivateKey,
  importPublicKey,
  importPrivateKey,
  generateKeyPair,
  keyFingerprint,
  exportKeyBackup,
  type KeyBackup,
} from '../crypto'

interface StoredKeyPair {
  userId: string        // primary key
  publicKey: string     // base64 SPKI
  privateKey: string    // base64 PKCS#8
  fingerprint: string
  createdAt: Date
}

class E2EEDatabase extends Dexie {
  keyPairs!: Table<StoredKeyPair, string>

  constructor() {
    super('chatter-e2ee')
    this.version(1).stores({
      keyPairs: 'userId',
    })
  }
}

const db = new E2EEDatabase()

// ─── Public API ────────────────────────────────────────────────────────────

/** Load the stored keypair for a user, or return null if none exists. */
export async function loadKeyPair(userId: string): Promise<CryptoKeyPair | null> {
  const row = await db.keyPairs.get(userId)
  if (!row) return null
  const [publicKey, privateKey] = await Promise.all([
    importPublicKey(row.publicKey),
    importPrivateKey(row.privateKey),
  ])
  return { publicKey, privateKey }
}

/** Persist a keypair for a user (upsert). */
export async function saveKeyPair(userId: string, pair: CryptoKeyPair): Promise<string> {
  const [pub, priv] = await Promise.all([
    exportPublicKey(pair.publicKey),
    exportPrivateKey(pair.privateKey),
  ])
  const fingerprint = await keyFingerprint(pair.publicKey)
  await db.keyPairs.put({
    userId,
    publicKey: pub,
    privateKey: priv,
    fingerprint,
    createdAt: new Date(),
  })
  return fingerprint
}

/** Delete the stored keypair for a user (e.g. during key rotation or account deletion). */
export async function deleteKeyPair(userId: string): Promise<void> {
  await db.keyPairs.delete(userId)
}

/** Load the stored fingerprint (faster than re-importing the key). */
export async function loadFingerprint(userId: string): Promise<string | null> {
  const row = await db.keyPairs.get(userId)
  return row?.fingerprint ?? null
}

/**
 * Generate a new keypair, persist it, and return it alongside its fingerprint.
 * If a keypair already exists it is REPLACED (key rotation path).
 */
export async function generateAndSaveKeyPair(
  userId: string,
): Promise<{ pair: CryptoKeyPair; fingerprint: string }> {
  const pair = await generateKeyPair()
  const fingerprint = await saveKeyPair(userId, pair)
  return { pair, fingerprint }
}

/** Export the stored keypair as a downloadable backup JSON object. */
export async function buildKeyBackup(userId: string): Promise<KeyBackup | null> {
  const pair = await loadKeyPair(userId)
  if (!pair) return null
  return exportKeyBackup(pair)
}

/** Trigger a browser download of the backup JSON file. */
export function downloadKeyBackup(backup: KeyBackup, username: string): void {
  const json = JSON.stringify(backup, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `chatter-e2ee-keys-${username}-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
