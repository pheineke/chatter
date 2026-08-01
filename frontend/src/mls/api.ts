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

export async function publishKeyPackage(keyPackage: Uint8Array): Promise<void> {
  await client.post('/mls/key-packages', { key_package: toB64(keyPackage) })
}

/** Claims (and marks consumed) one of `userId`'s published KeyPackages.
 * Throws if none are available (404) — caller should surface this as
 * "user is offline / hasn't published key material yet". */
export async function fetchKeyPackage(userId: string): Promise<Uint8Array> {
  const { data } = await client.get(`/mls/key-packages/${userId}`)
  return fromB64(data.key_package)
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

export { toB64, fromB64 }
