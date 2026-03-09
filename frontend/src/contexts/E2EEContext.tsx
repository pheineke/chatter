/**
 * E2EEContext
 *
 * Provides end-to-end encryption primitives to the whole app tree.
 *
 * On mount (once a user is logged in):
 *   1. Check IndexedDB for an existing keypair.
 *   2. If none → generate one, persist it, and upload the public key to the server.
 *   3. Expose `encryptForUser()` and `decryptMessage()` functions.
 *
 * Shared keys are cached in a Map (keyed by partner userId) so the ECDH
 * derivation only happens once per conversation per session.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  deriveSharedKey,
  encryptMessage,
  decryptMessage as cryptoDecrypt,
  importPublicKey,
  exportPublicKey,
  keyFingerprint,
  type EncryptedPayload,
} from '../crypto'
import {
  loadKeyPair,
  generateAndSaveKeyPair,
  buildKeyBackup,
  downloadKeyBackup,
  saveKeyPair,
  deleteKeyPair,
} from '../db/keyStore'
import {
  publishPublicKey,
  getUserPublicKey,
} from '../api/e2ee'
import { importKeyBackup, type KeyBackup } from '../crypto'

// ─── Module-level dedup for keypair initialisation ─────────────────────────
// Prevents React Strict Mode double-mount from generating two different keypairs
// that race against each other in IndexedDB and the server.

const _ensureKeyPairPromises = new Map<string, Promise<{ pair: CryptoKeyPair; fingerprint: string; pubB64: string }>>()

function ensureKeyPair(userId: string): Promise<{ pair: CryptoKeyPair; fingerprint: string; pubB64: string }> {
  let p = _ensureKeyPairPromises.get(userId)
  if (!p) {
    p = (async () => {
      let pair = await loadKeyPair(userId)
      let fp: string
      if (!pair) {
        const result = await generateAndSaveKeyPair(userId)
        pair = result.pair
        fp = result.fingerprint
      } else {
        fp = await keyFingerprint(pair.publicKey)
      }
      const pubB64 = await exportPublicKey(pair.publicKey)
      return { pair, fingerprint: fp, pubB64 }
    })()
    _ensureKeyPairPromises.set(userId, p)
    p.finally(() => _ensureKeyPairPromises.delete(userId))
  }
  return p
}

// ─── Context shape ─────────────────────────────────────────────────────────

export interface E2EEContextValue {
  /** Whether the local keypair has been initialised */
  ready: boolean
  /** True while initialisation is running */
  initialising: boolean
  /** The user's public key fingerprint (for display in the DM header) */
  fingerprint: string | null
  /** Whether the current user has E2EE enabled (keypair exists + published) */
  isEnabled: boolean

  /**
   * Encrypt a plaintext string for a given DM partner.
   * Returns null if the partner has no published public key (E2EE unavailable).
   */
  encryptForUser(partnerId: string, plaintext: string): Promise<EncryptedPayload | null>

  /**
   * Decrypt an encrypted DM message.
   * Returns the plaintext, or null on failure (wrong key / tampered ciphertext).
   */
  decryptFromUser(partnerId: string, ciphertext: string, nonce: string): Promise<string | null>

  /**
   * Get the partner's fingerprint for display.  Returns null if no key found.
   */
  getPartnerFingerprint(partnerId: string): Promise<string | null>

  /** Export the keypair as a downloadable JSON backup. */
  downloadBackup(username: string): Promise<void>

  /** Import a keypair from a JSON backup file (replaces any existing key). */
  importBackup(backup: KeyBackup): Promise<void>

  /** Rotate the keypair: generate new one, re-publish, clear shared key cache. */
  rotateKeyPair(): Promise<void>
}

const E2EEContext = createContext<E2EEContextValue | null>(null)

// ─── Provider ──────────────────────────────────────────────────────────────

interface Props {
  userId: string
  children: React.ReactNode
}

export function E2EEProvider({ userId, children }: Props) {
  const [ready, setReady] = useState(false)
  const [initialising, setInitialising] = useState(true)
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  const [isEnabled, setIsEnabled] = useState(false)

  // Cached keypair (in memory for the session)
  const keyPairRef = useRef<CryptoKeyPair | null>(null)

  // Shared-key cache: partnerId → AES-GCM CryptoKey
  const sharedKeyCache = useRef<Map<string, CryptoKey>>(new Map())

  // ── Initialise on mount ────────────────────────────────────────────────

  useEffect(() => {
    if (!userId) return

    let cancelled = false

    async function init() {
      setInitialising(true)
      try {
        // ensureKeyPair is deduped at module level so concurrent calls
        // (e.g. React Strict Mode double-mount) share the same promise
        // and always get the same keypair.
        const { pair, fingerprint: fp, pubB64 } = await ensureKeyPair(userId)

        // Publish unconditionally — handles fresh generation AND
        // re-sync after server DB resets / key drift.
        try { await publishPublicKey(pubB64, fp) } catch { /* non-fatal */ }

        if (!cancelled) {
          keyPairRef.current = pair
          setFingerprint(fp)
          setIsEnabled(true)
          setReady(true)
        }
      } catch (err) {
        console.error('[E2EE] Initialisation failed:', err)
        // Non-fatal — app still works, DMs will be unencrypted
        if (!cancelled) {
          setReady(false)
          setIsEnabled(false)
        }
      } finally {
        if (!cancelled) setInitialising(false)
      }
    }

    init()

    return () => {
      cancelled = true
    }
  }, [userId])

  // ── Shared key derivation (with cache) ───────────────────────────────────

  const getSharedKey = useCallback(async (partnerId: string): Promise<CryptoKey | null> => {
    const cached = sharedKeyCache.current.get(partnerId)
    if (cached) return cached

    const myPair = keyPairRef.current
    if (!myPair) return null

    const theirKeyInfo = await getUserPublicKey(partnerId)
    if (!theirKeyInfo) return null

    try {
      const theirKey = await importPublicKey(theirKeyInfo.public_key)
      const shared = await deriveSharedKey(myPair.privateKey, theirKey)
      sharedKeyCache.current.set(partnerId, shared)
      return shared
    } catch {
      return null
    }
  }, [])

  // ── Public API ────────────────────────────────────────────────────────────

  const encryptForUser = useCallback(
    async (partnerId: string, plaintext: string): Promise<EncryptedPayload | null> => {
      if (!isEnabled) return null
      const key = await getSharedKey(partnerId)
      if (!key) return null
      return encryptMessage(key, plaintext)
    },
    [isEnabled, getSharedKey],
  )

  const decryptFromUser = useCallback(
    async (partnerId: string, ciphertext: string, nonce: string): Promise<string | null> => {
      if (!isEnabled) return null
      const key = await getSharedKey(partnerId)
      if (!key) return null
      return cryptoDecrypt(key, ciphertext, nonce)
    },
    [isEnabled, getSharedKey],
  )

  const getPartnerFingerprint = useCallback(
    async (partnerId: string): Promise<string | null> => {
      const info = await getUserPublicKey(partnerId)
      return info?.fingerprint ?? null
    },
    [],
  )

  const downloadBackup = useCallback(
    async (username: string) => {
      const backup = await buildKeyBackup(userId)
      if (backup) downloadKeyBackup(backup, username)
    },
    [userId],
  )

  const importBackup = useCallback(
    async (backup: KeyBackup) => {
      const pair = await importKeyBackup(backup)
      await saveKeyPair(userId, pair)
      keyPairRef.current = pair
      sharedKeyCache.current.clear()
      const fp = await keyFingerprint(pair.publicKey)
      setFingerprint(fp)
      // Re-publish the imported public key
      const pubB64 = await exportPublicKey(pair.publicKey)
      await publishPublicKey(pubB64, fp)
      setIsEnabled(true)
      setReady(true)
    },
    [userId],
  )

  const rotateKeyPair = useCallback(async () => {
    await deleteKeyPair(userId)
    sharedKeyCache.current.clear()
    keyPairRef.current = null
    _ensureKeyPairPromises.delete(userId) // allow fresh generation
    const { pair, fingerprint: fp } = await generateAndSaveKeyPair(userId)
    keyPairRef.current = pair
    setFingerprint(fp)
    const pubB64 = await exportPublicKey(pair.publicKey)
    await publishPublicKey(pubB64, fp)
  }, [userId])

  const value = useMemo<E2EEContextValue>(
    () => ({
      ready,
      initialising,
      fingerprint,
      isEnabled,
      encryptForUser,
      decryptFromUser,
      getPartnerFingerprint,
      downloadBackup,
      importBackup,
      rotateKeyPair,
    }),
    [
      ready, initialising, fingerprint, isEnabled,
      encryptForUser, decryptFromUser, getPartnerFingerprint,
      downloadBackup, importBackup, rotateKeyPair,
    ],
  )

  return <E2EEContext.Provider value={value}>{children}</E2EEContext.Provider>
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useE2EE(): E2EEContextValue {
  const ctx = useContext(E2EEContext)
  if (!ctx) throw new Error('useE2EE must be used inside <E2EEProvider>')
  return ctx
}
