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
        let pair = await loadKeyPair(userId)

        if (!pair) {
          // First run: generate, persist, and publish
          const { pair: newPair, fingerprint: fp } = await generateAndSaveKeyPair(userId)
          pair = newPair
          const pubB64 = await exportPublicKey(newPair.publicKey)
          await publishPublicKey(pubB64, fp)
          if (!cancelled) {
            setFingerprint(fp)
          }
        } else {
          const fp = await keyFingerprint(pair.publicKey)
          if (!cancelled) setFingerprint(fp)
        }

        if (!cancelled) {
          keyPairRef.current = pair
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
