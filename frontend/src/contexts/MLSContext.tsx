/**
 * MLSContext
 *
 * Provides MLS (RFC 9420) group-encryption primitives to the whole app tree,
 * covering both server text channels and DMs (one MLS group per channel_id
 * — see backend/models/mls.py). Replaces the old static-ECDH DM-only scheme
 * (E2EEContext) for message encryption; E2EEContext itself stays alive only
 * for the unrelated per-user "notes" feature (ProfileFullModal.tsx).
 *
 * On mount: generates/loads this device's persistent MLS identity and tops
 * up its published KeyPackage pool. Listens on a dedicated /ws/me connection
 * for mls.commit / mls.welcome push notifications and re-syncs the affected
 * channel in the background, so open conversations stay decryptable without
 * waiting for the next send/receive to trigger a catch-up.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as mls from '../mls'
import { useWebSocket } from '../hooks/useWebSocket'

/**
 * Why a message couldn't be shown in the clear.
 *
 * `before_you_joined` is the expected, permanent, non-alarming case: MLS
 * only lets a member derive secrets from the epoch they were added onward,
 * so history predating your Add is cryptographically unreachable — by
 * design, not by malfunction. Worth telling the user apart from `failed`,
 * which means something actually went wrong (missing group state, corrupt
 * ciphertext, a bug) and may be worth retrying or reporting.
 */
export type DecryptResult =
  | { status: 'ok'; plaintext: string }
  | { status: 'before_you_joined' }
  | { status: 'failed' }

export interface MLSContextValue {
  /** True once this device's identity + key package pool are set up. */
  ready: boolean

  /**
   * Make sure a channel's MLS group is usable before sending/decrypting:
   * syncs any pending commits/welcomes, and if nobody has founded the group
   * yet, founds it and Adds `initialMembers` (used for brand-new DMs/channels).
   * Safe to call repeatedly/concurrently for the same channel.
   */
  ensureChannelReady(channelId: string, initialMembers?: string[]): Promise<void>

  /** Returns null if the channel has no usable local MLS state (caller
   * should fall back to a "not encrypted yet" state rather than blocking). */
  encryptForChannel(channelId: string, plaintext: string): Promise<{ ciphertext: string; epoch: number } | null>

  decryptForChannel(channelId: string, ciphertext: string, epoch: number): Promise<DecryptResult>

  addMember(channelId: string, userId: string): Promise<void>
  removeMember(channelId: string, userId: string): Promise<void>
  hasGroup(channelId: string): Promise<boolean>
}

/** Exported so tests can inject a stub value without standing up the real
 * provider, which would pull WebCrypto, ts-mls and IndexedDB into jsdom for
 * components that only incidentally consume this context. App code should
 * use `useMLS()` / `<MLSProvider>` rather than touching this directly. */
export const MLSContext = createContext<MLSContextValue | null>(null)

interface Props {
  userId: string
  children: React.ReactNode
}

// Dedup identity/key-package bootstrap across concurrent mounts (React
// Strict Mode double-invoke), same pattern as E2EEContext's ensureKeyPair.
const _bootstrapPromises = new Map<string, Promise<void>>()

function bootstrap(userId: string): Promise<void> {
  let p = _bootstrapPromises.get(userId)
  if (!p) {
    p = (async () => {
      await mls.ensureIdentity(userId)
      await mls.topUpKeyPackages(userId)
    })()
    _bootstrapPromises.set(userId, p)
    p.finally(() => _bootstrapPromises.delete(userId))
  }
  return p
}

// Per-channel mutex so concurrent callers (e.g. a fast-typing user hitting
// send twice, or ensureChannelReady + a background sync overlapping) don't
// interleave ts-mls calls against the same local ClientState, which isn't
// safe (each call reads-modifies-persists the whole state).
const _channelLocks = new Map<string, Promise<unknown>>()

function withChannelLock<T>(channelId: string, fn: () => Promise<T>): Promise<T> {
  const prior = _channelLocks.get(channelId) ?? Promise.resolve()
  const next = prior.then(fn, fn)
  _channelLocks.set(channelId, next.catch(() => {}))
  return next
}

export function MLSProvider({ userId, children }: Props) {
  const [ready, setReady] = useState(false)
  const foundedRef = useRef<Set<string>>(new Set()) // channels we've confirmed have a remote group this session

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    bootstrap(userId)
      .then(() => { if (!cancelled) setReady(true) })
      .catch((err) => console.error('[MLS] Identity/key-package bootstrap failed:', err))
    return () => { cancelled = true }
  }, [userId])

  const ensureChannelReady = useCallback(
    async (channelId: string, initialMembers: string[] = []) => {
      await withChannelLock(channelId, async () => {
        await mls.syncGroup(channelId, userId)
        if (await mls.hasLocalGroupState(channelId)) {
          foundedRef.current.add(channelId)
          // Reconcile MLS membership against who should be here.
          //
          // Adds are event-driven (useServerWS reacts to server.member_joined),
          // but only a client that already holds group state can commit one —
          // so if nobody like that happened to be online at the moment someone
          // joined, that person is never Added and silently sees nothing,
          // forever. Re-checking whenever a member opens the channel turns
          // that permanent hole into a delay: the next person to show up
          // repairs it.
          //
          // Losing the race to a concurrent committer is fine and expected;
          // addMemberToGroup throws on a stale epoch and we simply try again
          // next time.
          const inGroup = new Set(await mls.groupMemberUserIds(channelId))
          const missing = initialMembers.filter((id) => id && !inGroup.has(id))
          for (const memberId of missing) {
            try {
              await mls.addMemberToGroup(channelId, memberId)
            } catch (err) {
              console.warn(`[MLS] could not reconcile ${memberId} into ${channelId}:`, err)
            }
          }
          return
        }
        if (foundedRef.current.has(channelId) || (await mls.remoteGroupExists(channelId))) {
          // Someone already founded this group — we just haven't received
          // our Welcome yet (they may not be online to Add us right now).
          // Nothing more to do client-side; a later sync will pick it up.
          return
        }

        // Nobody has founded this group yet — found it as the caller and
        // Add every other initial member in one commit.
        try {
          await mls.createGroupAsFounder(channelId, userId)
          const others = initialMembers.filter((id) => id !== userId)
          for (const memberId of others) {
            await mls.addMemberToGroup(channelId, memberId)
          }
          foundedRef.current.add(channelId)
        } catch (err) {
          // Lost the founder race to another client (see resetLocalGroup's
          // doc comment in session.ts): our local "founding" state doesn't
          // match whichever commit actually won server-side. Discard it and
          // sync again — this will find and process the real founder's
          // Welcome instead.
          //
          // The winner's Add-commit (with our Welcome) may not have reached
          // the server yet at this exact instant — both sides typically hit
          // this path within milliseconds of each other when a brand-new DM
          // is opened by both participants around the same time, and the
          // winner still has to fetch our KeyPackage and build+submit their
          // own commit after "winning". A single immediate sync attempt was
          // observed to lose this race often enough in practice to leave us
          // permanently stuck with no group (nothing else retries), so give
          // the winner a few short windows to finish before giving up.
          await mls.resetLocalGroup(channelId)
          for (const delayMs of [0, 300, 800, 1500]) {
            if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
            await mls.syncGroup(channelId, userId)
            if (await mls.hasLocalGroupState(channelId)) break
          }
          if (!(await mls.hasLocalGroupState(channelId))) throw err
        }
      })
    },
    [userId],
  )

  const encryptForChannel = useCallback(
    async (channelId: string, plaintext: string) => {
      try {
        const result = await withChannelLock(channelId, () => mls.encryptForChannel(channelId, plaintext))
        // session.ts works in raw Uint8Array; the app carries ciphertext as
        // base64 in `messages.content` (JSON), so convert at this boundary.
        const ciphertext = mls.toB64(result.ciphertext)
        // See storage.ts's savePlaintext: this isn't a UI-latency
        // optimization — the sender can never legitimately re-decrypt this
        // ciphertext again once encrypted (MLS forward secrecy), so this
        // cache is the only way this device will ever see this content again.
        await mls.cachePlaintext(ciphertext, plaintext)
        return { ciphertext, epoch: result.epoch }
      } catch (err) {
        console.error('[MLS] encrypt failed:', err)
        return null
      }
    },
    [],
  )

  const decryptForChannel = useCallback(
    async (channelId: string, ciphertext: string, epoch: number) => {
      // Whole operation runs under the channel lock, including the cache
      // check: two concurrent callers for the same ciphertext (a re-render
      // racing the initial mount, say) would otherwise both miss the cache
      // and both attempt a real decrypt, and the loser fails permanently
      // with "Desired gen in the past" — the ratchet only allows one.
      return withChannelLock(channelId, async (): Promise<DecryptResult> => {
        const cached = await mls.getCachedPlaintext(ciphertext)
        if (cached !== null) return { status: 'ok', plaintext: cached }
        try {
          const plaintext = await mls.decryptFromChannel(
            channelId,
            userId,
            mls.fromB64(ciphertext),
            epoch,
          )
          // Required, not an optimization — see storage.ts's savePlaintext.
          // This ciphertext can never be decrypted again on this device.
          await mls.cachePlaintext(ciphertext, plaintext)
          return { status: 'ok', plaintext }
        } catch (err) {
          if (mls.isEpochTooOld(err)) {
            // Not a malfunction: this message predates our Add to the group,
            // so we never had (and can never obtain) the keys for it.
            return { status: 'before_you_joined' }
          }
          console.error('[MLS] decrypt failed:', err)
          return { status: 'failed' }
        }
      })
    },
    [userId],
  )

  const addMember = useCallback(
    (channelId: string, memberId: string) =>
      withChannelLock(channelId, () => mls.addMemberToGroup(channelId, memberId)),
    [],
  )

  const removeMember = useCallback(
    (channelId: string, memberId: string) =>
      withChannelLock(channelId, () => mls.removeMemberFromGroup(channelId, memberId)),
    [],
  )

  const hasGroup = useCallback((channelId: string) => mls.hasLocalGroupState(channelId), [])

  // Dedicated /ws/me connection for mls.* push events. A second /ws/me
  // connection alongside useUnreadDMs's is a small inefficiency (double
  // connection + auth handshake) traded for keeping this context fully
  // self-contained rather than threading a callback through AppShell.
  useWebSocket('/ws/me', {
    enabled: !!userId,
    onMessage(msg) {
      if (msg.type !== 'mls.commit' && msg.type !== 'mls.welcome') return
      const data = msg.data as { channel_id?: string } | undefined
      const channelId = data?.channel_id
      if (!channelId) return
      withChannelLock(channelId, () => mls.syncGroup(channelId, userId)).catch((err) =>
        console.error('[MLS] background sync failed:', err),
      )
    },
  })

  const value = useMemo<MLSContextValue>(
    () => ({
      ready,
      ensureChannelReady,
      encryptForChannel,
      decryptForChannel,
      addMember,
      removeMember,
      hasGroup,
    }),
    [ready, ensureChannelReady, encryptForChannel, decryptForChannel, addMember, removeMember, hasGroup],
  )

  return <MLSContext.Provider value={value}>{children}</MLSContext.Provider>
}

export function useMLS(): MLSContextValue {
  const ctx = useContext(MLSContext)
  if (!ctx) throw new Error('useMLS must be used inside <MLSProvider>')
  return ctx
}
