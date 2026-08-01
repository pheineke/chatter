/**
 * IndexedDB persistence for MLS client state.
 *
 * Everything ts-mls-specific (ClientState, PrivateKeyPackage, signature
 * keypairs) is serialized to raw bytes and stored here; nothing outside
 * src/mls/ ever touches these tables directly — see index.ts for the public
 * surface. Keeping storage isolated here (rather than spreading Dexie calls
 * through session.ts) means a future swap to a different MLS implementation
 * only has to change how these bytes are produced/consumed, not where they
 * live.
 *
 * Layout: DB "chatter-mls" (version 1)
 *   identity        — one persistent Ed25519 signature keypair per user
 *   groups          — one row per channel_id: serialized ClientState + sync bookmark
 *   keyPackagePool  — locally generated (unpublished-private-half) KeyPackages
 *                      awaiting a Welcome that references them
 *
 * Like the legacy E2EE keyStore (src/db/keyStore.ts), this holds private key
 * material in plaintext IndexedDB — protected only by browser same-origin
 * storage isolation, matching the existing risk posture of this app (not a
 * regression). See docs/backlog.md for the broader at-rest-encryption caveat.
 */
import Dexie, { type Table } from 'dexie'

interface StoredIdentity {
  userId: string // primary key
  signKey: Uint8Array
  publicKey: Uint8Array
}

interface StoredGroup {
  channelId: string // primary key
  clientState: Uint8Array // ts-mls encodeGroupState() output
  lastProcessedSeq: number // highest MLSGroupEvent.seq applied so far
  updatedAt: Date
}

interface StoredKeyPackage {
  id?: number // autoincrement pk
  userId: string // owning local user, indexed
  publicPackage: Uint8Array // encoded KeyPackage (TLS wire format, undecoded here)
  privateInitKey: Uint8Array
  privateHpkeKey: Uint8Array
  privateSignatureKey: Uint8Array
  consumed: boolean
  createdAt: Date
}

class MlsDatabase extends Dexie {
  identity!: Table<StoredIdentity, string>
  groups!: Table<StoredGroup, string>
  keyPackagePool!: Table<StoredKeyPackage, number>

  constructor() {
    super('chatter-mls')
    this.version(1).stores({
      identity: 'userId',
      groups: 'channelId',
      keyPackagePool: '++id, userId, consumed',
    })
  }
}

const db = new MlsDatabase()

// ─── Identity ───────────────────────────────────────────────────────────────

export async function loadIdentity(userId: string): Promise<StoredIdentity | null> {
  return (await db.identity.get(userId)) ?? null
}

export async function saveIdentity(
  userId: string,
  signKey: Uint8Array,
  publicKey: Uint8Array,
): Promise<void> {
  await db.identity.put({ userId, signKey, publicKey })
}

// ─── Group state ────────────────────────────────────────────────────────────

export async function loadGroup(channelId: string): Promise<StoredGroup | null> {
  return (await db.groups.get(channelId)) ?? null
}

export async function saveGroup(
  channelId: string,
  clientState: Uint8Array,
  lastProcessedSeq: number,
): Promise<void> {
  await db.groups.put({ channelId, clientState, lastProcessedSeq, updatedAt: new Date() })
}

export async function deleteGroup(channelId: string): Promise<void> {
  await db.groups.delete(channelId)
}

// ─── Key package pool ───────────────────────────────────────────────────────

export async function addKeyPackageToPool(
  userId: string,
  publicPackage: Uint8Array,
  privateInitKey: Uint8Array,
  privateHpkeKey: Uint8Array,
  privateSignatureKey: Uint8Array,
): Promise<void> {
  await db.keyPackagePool.add({
    userId,
    publicPackage,
    privateInitKey,
    privateHpkeKey,
    privateSignatureKey,
    consumed: false,
    createdAt: new Date(),
  })
}

export async function countUnconsumedKeyPackages(userId: string): Promise<number> {
  return db.keyPackagePool.where({ userId, consumed: false }).count()
}

/** Every locally-held unconsumed KeyPackage private half, newest first — used
 * to find the one a Welcome was actually encrypted against (see session.ts
 * joinFromWelcome: ts-mls doesn't expose a cheap way to inspect a Welcome's
 * intended recipient ahead of time, so we try candidates until one works). */
export async function unconsumedKeyPackages(userId: string): Promise<StoredKeyPackage[]> {
  const rows = await db.keyPackagePool.where({ userId, consumed: false }).toArray()
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

export async function markKeyPackageConsumed(id: number): Promise<void> {
  await db.keyPackagePool.update(id, { consumed: true })
}

export async function pruneConsumedKeyPackages(userId: string): Promise<void> {
  await db.keyPackagePool.where({ userId, consumed: true }).delete()
}

export type { StoredKeyPackage }
