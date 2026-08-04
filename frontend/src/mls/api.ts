/**
 * REST wrapper for the backend's MLS delivery-service endpoints
 * (backend/app/routers/mls.py). All protocol payloads cross the wire as
 * base64 strings; this file is the only place in the frontend that knows
 * that encoding — session.ts works exclusively in Uint8Array.
 */
import { client } from '../api/client'

function toB64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function fromB64(s: string): Uint8Array {
  const binary = atob(s)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export interface RemoteGroup {
  channelId: string
  ciphersuite: string
  currentEpoch: number
  groupInfo: Uint8Array | null
}

export interface RemoteGroupEvent {
  id: string
  channelId: string
  seq: number
  epoch: number
  eventType: 'commit' | 'welcome' | 'proposal'
  senderUserId: string
  recipientUserId: string | null
  payload: Uint8Array
}

export async function publishKeyPackage(keyPackage: Uint8Array, deviceId: string): Promise<void> {
  await client.post('/mls/key-packages', { key_package: toB64(keyPackage), device_id: deviceId })
}

/** Delete still-unclaimed KeyPackages belonging to one of our own devices.
 * Scoped to a device on purpose — a user's other devices are live and need
 * their published packages left alone. */
export async function purgeMyKeyPackages(deviceId: string): Promise<void> {
  await client.delete('/mls/key-packages', { params: { device_id: deviceId } })
}

/** Claims (and marks consumed) one KeyPackage for *each* of `userId`'s
 * devices, so every device can be Added to the group in a single commit.
 * Returns an empty array if the user has no usable key material at all
 * (never online, or every device's pool is drained) — callers decide
 * whether that's fatal. */
export async function fetchKeyPackages(
  userId: string,
): Promise<{ deviceId: string; keyPackage: Uint8Array }[]> {
  const { data } = await client.get(`/mls/key-packages/${userId}`)
  return (data as { device_id: string; key_package: string }[]).map((kp) => ({
    deviceId: kp.device_id,
    keyPackage: fromB64(kp.key_package),
  }))
}

export async function initGroup(channelId: string, ciphersuite: string): Promise<RemoteGroup> {
  const { data } = await client.post(`/mls/groups/${channelId}`, { ciphersuite })
  return {
    channelId: data.channel_id,
    ciphersuite: data.ciphersuite,
    currentEpoch: data.current_epoch,
    groupInfo: data.group_info ? fromB64(data.group_info) : null,
  }
}

export async function getGroup(channelId: string): Promise<RemoteGroup | null> {
  try {
    const { data } = await client.get(`/mls/groups/${channelId}`)
    return {
      channelId: data.channel_id,
      ciphersuite: data.ciphersuite,
      currentEpoch: data.current_epoch,
      groupInfo: data.group_info ? fromB64(data.group_info) : null,
    }
  } catch (err: any) {
    if (err?.response?.status === 404) return null
    throw err
  }
}

export interface CommitPayload {
  parentEpoch: number
  commit: Uint8Array
  welcomes: { recipientUserId: string; welcome: Uint8Array }[]
  groupInfo?: Uint8Array
}

/** Returns null on a 409 (stale epoch) so the caller can sync + retry
 * instead of having to unwrap an exception for an expected race outcome. */
export async function submitCommit(
  channelId: string,
  payload: CommitPayload,
): Promise<{ epoch: number; seq: number } | null> {
  try {
    const { data } = await client.post(`/mls/groups/${channelId}/commit`, {
      parent_epoch: payload.parentEpoch,
      commit: toB64(payload.commit),
      welcomes: payload.welcomes.map((w) => ({
        recipient_user_id: w.recipientUserId,
        welcome: toB64(w.welcome),
      })),
      group_info: payload.groupInfo ? toB64(payload.groupInfo) : undefined,
    })
    return { epoch: data.epoch, seq: data.seq }
  } catch (err: any) {
    if (err?.response?.status === 409) return null
    throw err
  }
}

export async function fetchGroupEvents(
  channelId: string,
  sinceSeq: number,
): Promise<RemoteGroupEvent[]> {
  const { data } = await client.get(`/mls/groups/${channelId}/events`, {
    params: { since_seq: sinceSeq },
  })
  return data.map((e: any) => ({
    id: e.id,
    channelId: e.channel_id,
    seq: e.seq,
    epoch: e.epoch,
    eventType: e.event_type,
    senderUserId: e.sender_user_id,
    recipientUserId: e.recipient_user_id,
    payload: fromB64(e.payload),
  }))
}

// ─── Link-time history transfer ────────────────────────────────────────────
// One of the user's devices handing readable history to another. The server
// relays ciphertext it has no key for and drops it on collection.

export interface HistoryRequest {
  id: string
  deviceId: string
  /** Base64 SPKI ECDH public key to encrypt the bundle to. */
  publicKey: string
  /** This device holds everything at or newer than here and wants older;
   * null means it has nothing yet and wants the newest first. */
  syncedBefore: Date | null
}

export interface HistoryBundle {
  id: string
  senderDeviceId: string
  /** Ephemeral ECDH public key to derive this bundle's shared secret from. */
  senderPublicKey: string
  ciphertext: string
  nonce: string
}

export async function requestHistory(
  deviceId: string,
  publicKey: string,
  syncedBefore: Date | null = null,
): Promise<void> {
  await client.post('/mls/history-requests', {
    device_id: deviceId,
    public_key: publicKey,
    synced_before: syncedBefore ? syncedBefore.toISOString() : null,
  })
}

/** This user's own devices currently waiting for history. */
export async function fetchHistoryRequests(): Promise<HistoryRequest[]> {
  const { data } = await client.get('/mls/history-requests')
  return (
    data as { id: string; device_id: string; public_key: string; synced_before: string | null }[]
  ).map((r) => ({
    id: r.id,
    deviceId: r.device_id,
    publicKey: r.public_key,
    syncedBefore: r.synced_before ? new Date(r.synced_before) : null,
  }))
}

/** Stop asking for history for a device — sent by a serving device once
 * there's nothing older left, which is how the requester learns it's done. */
export async function deleteHistoryRequest(deviceId: string): Promise<void> {
  await client.delete('/mls/history-requests', { params: { device_id: deviceId } })
}

export async function uploadHistoryBundle(payload: {
  targetDeviceId: string
  senderDeviceId: string
  senderPublicKey: string
  ciphertext: string
  nonce: string
}): Promise<void> {
  await client.post('/mls/history-bundles', {
    target_device_id: payload.targetDeviceId,
    sender_device_id: payload.senderDeviceId,
    sender_public_key: payload.senderPublicKey,
    ciphertext: payload.ciphertext,
    nonce: payload.nonce,
  })
}

export async function fetchHistoryBundles(deviceId: string): Promise<HistoryBundle[]> {
  const { data } = await client.get('/mls/history-bundles', { params: { device_id: deviceId } })
  return (
    data as {
      id: string
      sender_device_id: string
      sender_public_key: string
      ciphertext: string
      nonce: string
    }[]
  ).map((b) => ({
    id: b.id,
    senderDeviceId: b.sender_device_id,
    senderPublicKey: b.sender_public_key,
    ciphertext: b.ciphertext,
    nonce: b.nonce,
  }))
}

/** Delete a bundle after importing it; also clears the served request. */
export async function consumeHistoryBundle(bundleId: string): Promise<void> {
  await client.delete(`/mls/history-bundles/${bundleId}`)
}

// ─── Recovery-code archive ─────────────────────────────────────────────────
// Persistent, unlike history bundles: this is the "lost every device" path.
// The server holds a salt, a verifier and ciphertext, and can read none of it.

export interface RecoveryArchiveMeta {
  kdfSalt: string
  verifierCiphertext: string
  verifierNonce: string
  chunkCount: number
}

export interface RecoveryArchiveChunk {
  id: string
  chunkKey: string
  ciphertext: string
  nonce: string
}

export async function putRecoveryArchiveMeta(payload: {
  kdfSalt: string
  verifierCiphertext: string
  verifierNonce: string
}): Promise<void> {
  await client.put('/mls/recovery-archive/meta', {
    kdf_salt: payload.kdfSalt,
    verifier_ciphertext: payload.verifierCiphertext,
    verifier_nonce: payload.verifierNonce,
  })
}

/** Null when the account has no archive configured. */
export async function fetchRecoveryArchiveMeta(): Promise<RecoveryArchiveMeta | null> {
  try {
    const { data } = await client.get('/mls/recovery-archive/meta')
    return {
      kdfSalt: data.kdf_salt,
      verifierCiphertext: data.verifier_ciphertext,
      verifierNonce: data.verifier_nonce,
      chunkCount: data.chunk_count,
    }
  } catch (err: any) {
    if (err?.response?.status === 404) return null
    throw err
  }
}

export async function putRecoveryArchiveChunk(payload: {
  chunkKey: string
  ciphertext: string
  nonce: string
}): Promise<void> {
  await client.put('/mls/recovery-archive/chunks', {
    chunk_key: payload.chunkKey,
    ciphertext: payload.ciphertext,
    nonce: payload.nonce,
  })
}

export async function fetchRecoveryArchiveChunks(
  sinceKey: string | null,
): Promise<RecoveryArchiveChunk[]> {
  const { data } = await client.get('/mls/recovery-archive/chunks', {
    params: sinceKey === null ? undefined : { since_key: sinceKey },
  })
  return (data as { id: string; chunk_key: string; ciphertext: string; nonce: string }[]).map((c) => ({
    id: c.id,
    chunkKey: c.chunk_key,
    ciphertext: c.ciphertext,
    nonce: c.nonce,
  }))
}

export async function deleteRecoveryArchive(): Promise<void> {
  await client.delete('/mls/recovery-archive')
}

export { toB64, fromB64 }
