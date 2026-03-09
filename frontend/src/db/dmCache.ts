/**
 * IndexedDB DM cache — persists recent DM messages and conversation metadata
 * so the user can read their DMs while offline.
 *
 * Uses Dexie for a clean async API alongside the E2EE keyStore.
 *
 * Layout:
 *   DB "chatter-dm-cache"  (version 1)
 *   ├─ dmMessages      { [channel_id+id] (pk), channel_id, created_at, …Message fields }
 *   ├─ dmConversations { channel_id (pk), …DMConversation fields }
 *   └─ dmOutbox        { localId (pk), channelId, content, created_at }
 */

import Dexie, { type Table } from 'dexie'
import type { Message, DMConversation } from '../api/types'

/** Maximum number of messages kept per DM conversation. */
const DM_MSG_CAP = 200

// ─── Schema ────────────────────────────────────────────────────────────────

/** A message waiting to be sent when we're back online. */
export interface OutboxMessage {
  localId: string      // PK (UUID generated client-side)
  channelId: string
  content: string
  created_at: string   // ISO timestamp (local clock, for ordering display)
}

class DMCacheDB extends Dexie {
  dmMessages!: Table<Message, [string, string]>
  dmConversations!: Table<DMConversation, string>
  dmOutbox!: Table<OutboxMessage, string>

  constructor() {
    super('chatter-dm-cache')
    this.version(1).stores({
      // Compound PK [channel_id+id]; secondary index on channel_id for range queries
      dmMessages: '[channel_id+id], channel_id, created_at',
      dmConversations: 'channel_id',
      dmOutbox: 'localId, channelId',
    })
    this.version(2).stores({
      dmMessages: '[channel_id+id], channel_id, created_at',
      dmConversations: 'channel_id',
      dmOutbox: 'localId, channelId, created_at',
    })
  }
}

export const dmCacheDB = new DMCacheDB()

// ─── Messages ──────────────────────────────────────────────────────────────

/**
 * Upsert a single message and prune the channel's history to DM_MSG_CAP.
 * Safe to call on every WS event.
 */
export async function cachePutMessage(msg: Message): Promise<void> {
  await dmCacheDB.dmMessages.put(msg)
  await _pruneChannel(msg.channel_id)
}

/**
 * Upsert many messages (e.g. a fetched page) and prune each affected channel.
 */
export async function cachePutMessages(msgs: Message[]): Promise<void> {
  if (!msgs.length) return
  await dmCacheDB.dmMessages.bulkPut(msgs)
  const channelIds = [...new Set(msgs.map((m) => m.channel_id))]
  await Promise.all(channelIds.map(_pruneChannel))
}

/** Delete a cached message (e.g. on WS message.deleted). */
export async function deleteCachedMessage(channelId: string, messageId: string): Promise<void> {
  await dmCacheDB.dmMessages.delete([channelId, messageId])
}

/** Read all cached messages for a channel, sorted oldest → newest. */
export async function getCachedMessages(channelId: string): Promise<Message[]> {
  return dmCacheDB.dmMessages
    .where('channel_id')
    .equals(channelId)
    .sortBy('created_at')
}

/**
 * Get the id of the newest cached message in a channel.
 * Used to determine the gap-sync cursor after a reconnect.
 */
export async function getLastCachedMessageId(channelId: string): Promise<string | null> {
  const rows = await dmCacheDB.dmMessages
    .where('channel_id')
    .equals(channelId)
    .reverse()
    .sortBy('created_at')
  return rows[0]?.id ?? null
}

/** Check whether we have any cached data for a channel. */
export async function hasCachedMessages(channelId: string): Promise<boolean> {
  const count = await dmCacheDB.dmMessages.where('channel_id').equals(channelId).count()
  return count > 0
}

async function _pruneChannel(channelId: string): Promise<void> {
  const count = await dmCacheDB.dmMessages.where('channel_id').equals(channelId).count()
  if (count <= DM_MSG_CAP) return
  const all = await dmCacheDB.dmMessages
    .where('channel_id')
    .equals(channelId)
    .sortBy('created_at')
  const toDelete = all.slice(0, count - DM_MSG_CAP)
  await dmCacheDB.dmMessages.bulkDelete(toDelete.map((m) => [m.channel_id, m.id] as [string, string]))
}

// ─── Conversations ─────────────────────────────────────────────────────────

/** Cache (upsert) a list of DM conversations. */
export async function cacheConversations(convs: DMConversation[]): Promise<void> {
  if (!convs.length) return
  await dmCacheDB.dmConversations.bulkPut(convs)
}

/** Read all cached conversations. */
export async function getCachedConversations(): Promise<DMConversation[]> {
  return dmCacheDB.dmConversations.toArray()
}

// ─── Outbox ────────────────────────────────────────────────────────────────

/** Queue a message for delivery when back online. */
export async function outboxEnqueue(item: OutboxMessage): Promise<void> {
  await dmCacheDB.dmOutbox.put(item)
}

/** Retrieve all pending outbox entries for a specific channel (oldest first). */
export async function outboxGetForChannel(channelId: string): Promise<OutboxMessage[]> {
  return dmCacheDB.dmOutbox.where('channelId').equals(channelId).sortBy('created_at')
}

/** All outbox entries across all channels (oldest first), for flush-on-reconnect. */
export async function outboxGetAll(): Promise<OutboxMessage[]> {
  return dmCacheDB.dmOutbox.orderBy('created_at').toArray()
}

/** Remove a delivered outbox entry by its localId. */
export async function outboxRemove(localId: string): Promise<void> {
  await dmCacheDB.dmOutbox.delete(localId)
}

// ─── Clear all ─────────────────────────────────────────────────────────────

/** Wipe the entire DM cache (messages, conversations, outbox). */
export async function clearDMCache(): Promise<void> {
  await Promise.all([
    dmCacheDB.dmMessages.clear(),
    dmCacheDB.dmConversations.clear(),
    dmCacheDB.dmOutbox.clear(),
  ])
}
