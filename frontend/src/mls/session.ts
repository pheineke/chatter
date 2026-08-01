/**
 * MLS (RFC 9420) group-session engine, built on ts-mls.
 *
 * This is the ONLY file in the app that imports from "ts-mls" or the
 * "@hpke/*" / "@noble/*" packages it pulls in. Everything else — React
 * contexts, MessageInput, MessageBubble — talks to the plain, library-agnostic
 * functions exported from ./index.ts. That boundary is intentional: ts-mls
 * has no formal security audit yet (it's the most complete TS implementation
 * of the RFC today), so if an audited alternative appears later, swapping it
 * in means rewriting this file and storage.ts, not touching the rest of the
 * app.
 *
 * One MLS group per `channel_id`, covering both server channels and DMs
 * (see backend/models/mls.py for the server-side rationale). The server is a
 * dumb relay: every ts-mls call here happens entirely client-side, and only
 * opaque ciphertext/commit bytes ever cross the network.
 */
import {
  generateKeyPackageWithKey,
  createGroup,
  makePskIndex,
  joinGroup,
  encodeGroupState,
  decodeGroupState,
  createApplicationMessage,
  createCommit,
  processMessage,
  decodeMlsMessage,
  encodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  getCiphersuiteImpl,
  getCiphersuiteFromName,
  emptyPskIndex,
  acceptAll,
  defaultKeyRetentionConfig,
  defaultLifetimeConfig,
  defaultKeyPackageEqualityConfig,
  defaultPaddingConfig,
  defaultAuthenticationService,
  type ClientState,
  type CiphersuiteImpl,
  type KeyPackage,
  type Credential,
  type ClientConfig,
  type Proposal,
} from 'ts-mls'
import * as api from './api'
import * as store from './storage'

export const CIPHERSUITE_NAME = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519' as const

// decodeGroupState only persists the GroupState half of ClientState (crypto
// material); clientConfig is local device policy, reconstructed here from
// ts-mls's individually-exported defaults (defaultClientConfig itself isn't
// part of the public package surface in 1.6.2 — see the note in the ts-mls
// validation notes captured during library evaluation).
const clientConfig: ClientConfig = {
  keyRetentionConfig: defaultKeyRetentionConfig,
  lifetimeConfig: defaultLifetimeConfig,
  keyPackageEqualityConfig: defaultKeyPackageEqualityConfig,
  paddingConfig: defaultPaddingConfig,
  authService: defaultAuthenticationService,
}

let _csPromise: Promise<CiphersuiteImpl> | null = null
function getCs(): Promise<CiphersuiteImpl> {
  if (!_csPromise) _csPromise = getCiphersuiteImpl(getCiphersuiteFromName(CIPHERSUITE_NAME))
  return _csPromise
}

function credentialFor(userId: string): Credential {
  return { credentialType: 'basic', identity: new TextEncoder().encode(userId) }
}

// In-memory cache of live ClientState per channel, so we're not
// decode/encode-round-tripping IndexedDB on every message.
const _liveState = new Map<string, ClientState>()

async function persist(channelId: string, state: ClientState, lastProcessedSeq: number) {
  _liveState.set(channelId, state)
  await store.saveGroup(channelId, encodeGroupState(state), lastProcessedSeq)
}

async function loadLive(channelId: string): Promise<{ state: ClientState; lastProcessedSeq: number } | null> {
  const cached = _liveState.get(channelId)
  if (cached) {
    const row = await store.loadGroup(channelId)
    return { state: cached, lastProcessedSeq: row?.lastProcessedSeq ?? 0 }
  }
  const row = await store.loadGroup(channelId)
  if (!row) return null
  const decoded = decodeGroupState(row.clientState, 0)
  if (!decoded) throw new Error(`Corrupt local MLS state for channel ${channelId}`)
  const state: ClientState = { ...decoded[0], clientConfig }
  _liveState.set(channelId, state)
  return { state, lastProcessedSeq: row.lastProcessedSeq }
}

// ─── Identity ───────────────────────────────────────────────────────────────

/** Long-term Ed25519 signing keypair for this (user, device). Reused across
 * every KeyPackage we generate so peers see a stable identity instead of a
 * new unrelated one on every Add. Generated once, cached in IndexedDB. */
export async function ensureIdentity(userId: string): Promise<{ signKey: Uint8Array; publicKey: Uint8Array }> {
  const existing = await store.loadIdentity(userId)
  if (existing) return existing
  const cs = await getCs()
  const { signKey, publicKey } = await cs.signature.keygen()
  await store.saveIdentity(userId, signKey, publicKey)
  return { signKey, publicKey }
}

// ─── KeyPackages ────────────────────────────────────────────────────────────

const KEY_PACKAGE_POOL_TARGET = 5

/** Top up this user's published KeyPackage pool if it's running low. Called
 * opportunistically (e.g. on login / app focus) rather than per-Add, since
 * KeyPackages are single-use and consumed by whoever Adds us next. */
export async function topUpKeyPackages(userId: string): Promise<void> {
  const remaining = await store.countUnconsumedKeyPackages(userId)
  if (remaining >= KEY_PACKAGE_POOL_TARGET) return

  const cs = await getCs()
  const identity = await ensureIdentity(userId)
  const credential = credentialFor(userId)

  for (let i = remaining; i < KEY_PACKAGE_POOL_TARGET; i++) {
    const { publicPackage, privatePackage } = await generateKeyPackageWithKey(
      credential,
      defaultCapabilities(),
      defaultLifetime,
      [],
      identity,
      cs,
    )
    const encoded = encodeMlsMessage({ wireformat: 'mls_key_package', keyPackage: publicPackage, version: 'mls10' })
    await store.addKeyPackageToPool(
      userId,
      encoded,
      privatePackage.initPrivateKey,
      privatePackage.hpkePrivateKey,
      privatePackage.signaturePrivateKey,
    )
    await api.publishKeyPackage(encoded)
  }
  await store.pruneConsumedKeyPackages(userId)
}

/** Decode bytes we expect to be a processable Commit/Proposal/Application
 * message (public or private wireformat) — i.e. anything valid as input to
 * processMessage(). Narrows away the KeyPackage/Welcome/GroupInfo variants
 * of MLSMessage so callers don't need an `as any` cast. */
function decodeProcessableMessage(encoded: Uint8Array) {
  const decoded = decodeMlsMessage(encoded, 0)
  if (!decoded) throw new Error('Failed to decode MLS message (malformed bytes)')
  const msg = decoded[0]
  if (msg.wireformat !== 'mls_private_message' && msg.wireformat !== 'mls_public_message') {
    throw new Error(`Expected a private/public MLS message, got wireformat '${msg.wireformat}'`)
  }
  return msg
}

function decodeKeyPackage(encoded: Uint8Array): KeyPackage {
  const decoded = decodeMlsMessage(encoded, 0)
  if (!decoded) throw new Error('Failed to decode MLS message (malformed KeyPackage bytes)')
  const msg = decoded[0]
  if (msg.wireformat !== 'mls_key_package') throw new Error('Expected an mls_key_package message')
  return msg.keyPackage
}

// ─── Group lifecycle ────────────────────────────────────────────────────────

export async function hasLocalGroupState(channelId: string): Promise<boolean> {
  return (await loadLive(channelId)) !== null
}

/** Check whether a group has already been founded server-side, without
 * requiring the caller to already be a member (used to decide "am I the
 * first person to touch this channel, or does a group already exist that
 * I just haven't been Welcomed into yet"). */
export async function remoteGroupExists(channelId: string): Promise<boolean> {
  return (await api.getGroup(channelId)) !== null
}

/** Discard local state for a channel. Used to recover from the founder race
 * where two clients both create a group for the same brand-new channel at
 * once: the server's optimistic-epoch-lock on commits (see
 * app/routers/mls.py commit_group) guarantees only one founder's founding
 * Add-commit can ever land, so the loser's local "founder" state is
 * cryptographically orphaned garbage — it shares the channel_id but not the
 * real group's secrets. Callers should reset and re-sync (which will then
 * find and process the winner's Welcome) rather than keep using it. */
export async function resetLocalGroup(channelId: string): Promise<void> {
  _liveState.delete(channelId)
  await store.deleteGroup(channelId)
}

export async function getGroupEpoch(channelId: string): Promise<number | null> {
  const live = await loadLive(channelId)
  return live ? Number(live.state.groupContext.epoch) : null
}

/** Bootstrap a brand-new group as its founding (and, until an Add, only)
 * member. Idempotent server-side — if another client already registered the
 * channel, `api.initGroup` just returns the existing record, and we detect
 * that and refuse to double-create locally (callers should check
 * hasLocalGroupState()/attempt sync first — this is for the true first
 * creator only). */
export async function createGroupAsFounder(channelId: string, userId: string): Promise<void> {
  const cs = await getCs()
  const identity = await ensureIdentity(userId)
  const credential = credentialFor(userId)
  const { publicPackage, privatePackage } = await generateKeyPackageWithKey(
    credential,
    defaultCapabilities(),
    defaultLifetime,
    [],
    identity,
    cs,
  )
  const groupIdBytes = new TextEncoder().encode(channelId).slice(0, 16)
  const groupId = new Uint8Array(16)
  groupId.set(groupIdBytes)

  const state = await createGroup(groupId, publicPackage, privatePackage, [], cs, clientConfig)
  await persist(channelId, state, 0)
  await api.initGroup(channelId, CIPHERSUITE_NAME)
}

/** Process every commit/welcome event newer than our local bookmark. Safe to
 * call repeatedly (e.g. before every send/decrypt, and on reconnect). If we
 * have no local state yet, looks for a Welcome addressed to us and joins. */
export async function syncGroup(channelId: string, userId: string): Promise<void> {
  const live = await loadLive(channelId)
  const cs = await getCs()
  const events = await api.fetchGroupEvents(channelId, live?.lastProcessedSeq ?? 0)
  if (events.length === 0) return

  let state = live?.state ?? null
  let lastSeq = live?.lastProcessedSeq ?? 0

  for (const event of events) {
    if (event.eventType === 'welcome') {
      if (state) {
        // Already in the group — this welcome is for someone else's copy of
        // history (or a re-join we don't need); skip.
        lastSeq = event.seq
        continue
      }
      const joined = await tryJoinFromWelcome(channelId, userId, event.payload, cs)
      if (joined) {
        state = joined
        lastSeq = event.seq
      }
      continue
    }

    // commit
    if (!state) {
      // We haven't joined yet and this is a commit we have no state to apply
      // — nothing to do until we find our welcome (may arrive at a later seq).
      lastSeq = event.seq
      continue
    }
    const msg = decodeProcessableMessage(event.payload)
    const result = await processMessage(msg, state, emptyPskIndex, acceptAll, cs)
    state = result.newState
    lastSeq = event.seq
  }

  // If we still have no state, we haven't found our Welcome yet (it may
  // arrive in a later batch) — nothing to persist in that case.
  if (state) await persist(channelId, state, lastSeq)
}

async function tryJoinFromWelcome(
  channelId: string,
  userId: string,
  welcomeBytes: Uint8Array,
  cs: CiphersuiteImpl,
): Promise<ClientState | null> {
  const decoded = decodeMlsMessage(welcomeBytes, 0)
  if (!decoded) return null
  const msg = decoded[0]
  if (msg.wireformat !== 'mls_welcome') return null

  // ts-mls's joinGroup needs the exact (KeyPackage, PrivateKeyPackage) pair
  // the Welcome was encrypted against, but nothing in the Welcome cheaply
  // tells us which of our locally-pooled KeyPackages that is — so we try
  // each unconsumed candidate (newest first) until joinGroup succeeds.
  const candidates = await store.unconsumedKeyPackages(userId)
  for (const candidate of candidates) {
    try {
      const keyPackage = decodeKeyPackage(candidate.publicPackage)
      const privatePackage = {
        initPrivateKey: candidate.privateInitKey,
        hpkePrivateKey: candidate.privateHpkeKey,
        signaturePrivateKey: candidate.privateSignatureKey,
      }
      const state = await joinGroup(msg.welcome, keyPackage, privatePackage, makePskIndex(undefined, {}), cs, undefined, undefined, clientConfig)
      if (candidate.id !== undefined) await store.markKeyPackageConsumed(candidate.id)
      return state
    } catch {
      // Not the right KeyPackage for this Welcome — try the next candidate.
      continue
    }
  }
  return null
}

// ─── Membership changes ─────────────────────────────────────────────────────

/** Fetch `memberUserId`'s KeyPackage from the server and commit an Add,
 * publishing the resulting Welcome. Throws if the target has no available
 * KeyPackages (they need to be online at least once with the app open to
 * have published some) or if our commit loses a concurrency race — callers
 * should sync and retry on failure. */
export async function addMemberToGroup(channelId: string, memberUserId: string): Promise<void> {
  const live = await loadLive(channelId)
  if (!live) throw new Error(`No local MLS state for channel ${channelId}; sync/join first`)
  const cs = await getCs()

  const kpBytes = await api.fetchKeyPackage(memberUserId)
  const keyPackage = decodeKeyPackage(kpBytes)

  const parentEpoch = Number(live.state.groupContext.epoch)
  const addResult = await createCommit(
    { state: live.state, cipherSuite: cs },
    { extraProposals: [{ proposalType: 'add', add: { keyPackage } }], ratchetTreeExtension: true },
  )
  if (!addResult.welcome) throw new Error('createCommit did not produce a Welcome for an Add proposal')

  const commitBytes = encodeMlsMessage(addResult.commit)
  const welcomeBytes = encodeMlsMessage({ wireformat: 'mls_welcome', welcome: addResult.welcome, version: 'mls10' })

  const result = await api.submitCommit(channelId, {
    parentEpoch,
    commit: commitBytes,
    welcomes: [{ recipientUserId: memberUserId, welcome: welcomeBytes }],
  })
  if (!result) {
    throw new Error('Commit lost a concurrency race (stale epoch) — sync and retry')
  }
  await persist(channelId, addResult.newState, result.seq)
}

/** Walk the local ratchet tree to find a member's leaf index by identity.
 * ts-mls doesn't re-export getGroupMembers/getOwnLeafNode from its public
 * surface in 1.6.2 (confirmed against the installed package's index.d.ts),
 * so Remove proposals need this manual lookup instead. Leaf nodes sit at
 * even positions in the flat array; leafIndex = nodeIndex / 2. */
function findLeafIndexByIdentity(state: ClientState, userId: string): number | undefined {
  const target = new TextEncoder().encode(userId)
  const tree = state.ratchetTree
  for (let nodeIndex = 0; nodeIndex < tree.length; nodeIndex += 2) {
    const node = tree[nodeIndex]
    if (node && node.nodeType === 'leaf') {
      const cred = node.leaf.credential
      if (
        cred.credentialType === 'basic' &&
        cred.identity.length === target.length &&
        cred.identity.every((b, i) => b === target[i])
      ) {
        return nodeIndex / 2
      }
    }
  }
  return undefined
}

export async function removeMemberFromGroup(channelId: string, memberUserId: string): Promise<void> {
  const live = await loadLive(channelId)
  if (!live) throw new Error(`No local MLS state for channel ${channelId}; sync/join first`)
  const cs = await getCs()

  const leafIndex = findLeafIndexByIdentity(live.state, memberUserId)
  if (leafIndex === undefined) throw new Error(`${memberUserId} is not a current member of this group`)

  const parentEpoch = Number(live.state.groupContext.epoch)
  const removeResult = await createCommit(
    { state: live.state, cipherSuite: cs },
    { extraProposals: [{ proposalType: 'remove', remove: { removed: leafIndex } } as Proposal], ratchetTreeExtension: true },
  )
  const commitBytes = encodeMlsMessage(removeResult.commit)

  const result = await api.submitCommit(channelId, { parentEpoch, commit: commitBytes, welcomes: [] })
  if (!result) throw new Error('Commit lost a concurrency race (stale epoch) — sync and retry')
  await persist(channelId, removeResult.newState, result.seq)
}

// ─── Application messages ───────────────────────────────────────────────────

export async function encryptForChannel(
  channelId: string,
  plaintext: string,
): Promise<{ ciphertext: Uint8Array; epoch: number }> {
  const live = await loadLive(channelId)
  if (!live) throw new Error(`No local MLS state for channel ${channelId}; sync/join first`)
  const cs = await getCs()

  const result = await createApplicationMessage(live.state, new TextEncoder().encode(plaintext), cs)
  const wire = encodeMlsMessage({ wireformat: 'mls_private_message', privateMessage: result.privateMessage, version: 'mls10' })
  const row = await store.loadGroup(channelId)
  await persist(channelId, result.newState, row?.lastProcessedSeq ?? 0)
  return { ciphertext: wire, epoch: Number(live.state.groupContext.epoch) }
}

/** Decrypt a message. If our local epoch is behind the message's epoch,
 * syncs first (fetching/applying any commits we've missed) and retries once. */
export async function decryptFromChannel(
  channelId: string,
  userId: string,
  ciphertext: Uint8Array,
  messageEpoch: number,
): Promise<string> {
  let live = await loadLive(channelId)
  const cs = await getCs()

  if (!live || Number(live.state.groupContext.epoch) < messageEpoch) {
    await syncGroup(channelId, userId)
    live = await loadLive(channelId)
  }
  if (!live) throw new Error(`No local MLS state for channel ${channelId} — cannot decrypt`)

  const msg = decodeProcessableMessage(ciphertext)
  const result = await processMessage(msg, live.state, emptyPskIndex, acceptAll, cs)
  const row = await store.loadGroup(channelId)
  await persist(channelId, result.newState, row?.lastProcessedSeq ?? 0)
  if (result.kind !== 'applicationMessage') {
    throw new Error(`Expected an application message, got ${result.kind}`)
  }
  return new TextDecoder().decode(result.message)
}
