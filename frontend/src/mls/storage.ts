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
 * Layout: DB "chatter-mls" (version 2)
 *   identity        — one persistent Ed25519 signature keypair per user
 *   groups          — one row per channel_id: serialized ClientState + sync bookmark
 *   keyPackagePool  — locally generated (unpublished-private-half) KeyPackages
 *                      awaiting a Welcome that references them
 *   ownPlaintext    — plaintext of messages this device encrypted & sent,
 *                      keyed by ciphertext (see the comment above
 *                      saveOwnPlaintext below for why this table has to
 *                      exist at all: the sender can never re-decrypt their
 *                      own ciphertext, even from freshly-persisted state)
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
  /** Stable per-(user, browser profile) identifier, minted on first use.
   *
   * MLS is a protocol between *devices*, not accounts: each device holds its
   * own signature key and occupies its own leaf in the ratchet tree. This id
   * is what lets us tell one of a user's devices from another — to Add every
   * device of a member to a group, to remove all of them when that member is
   * kicked, and to avoid one device clobbering another's published
   * KeyPackages. Generated locally and never reused across profiles, so
   * clearing site data yields a genuinely new device, which is the correct
   * interpretation: the old device's private keys are gone. */
  deviceId: string
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
  /** 0 = available, 1 = already used to join a group.
   *
   * Deliberately a number, NOT a boolean: IndexedDB's structured-key spec
   * has no boolean key type, so a `consumed: false` field is stored but is
   * completely invisible to the `consumed` index. That silently broke every
   * `where({ userId, consumed: false })` lookup — they returned zero rows
   * forever, which made joins from a Welcome always fail (no candidate
   * KeyPackages found) and made the pool top-up believe it had none and
   * generate five more on every single page load. */
  consumed: 0 | 1
  createdAt: Date
}

interface StoredPlaintext {
  ciphertext: string // base64-encoded MLS PrivateMessage wire bytes — primary key
  plaintext: string
  createdAt: Date
}

class MlsDatabase extends Dexie {
  identity!: Table<StoredIdentity, string>
  groups!: Table<StoredGroup, string>
  keyPackagePool!: Table<StoredKeyPackage, number>
  plaintextCache!: Table<StoredPlaintext, string>

  constructor() {
    super('chatter-mls')
    this.version(1).stores({
      identity: 'userId',
      groups: 'channelId',
      keyPackagePool: '++id, userId, consumed',
    })
    // v2: added a plaintext cache (see savePlaintext's doc comment below).
    // Purely additive.
    this.version(2).stores({
      identity: 'userId',
      groups: 'channelId',
      keyPackagePool: '++id, userId, consumed',
      plaintextCache: 'ciphertext',
    })
    // v3: keyPackagePool.consumed changes from boolean to 0|1 (see the field's
    // doc comment — booleans are not indexable in IndexedDB, so the old rows
    // were invisible to every query that filtered on it). Schema string is
    // unchanged; the upgrade only rewrites existing rows' values.
    this.version(3)
      .stores({
        identity: 'userId',
        groups: 'channelId',
        keyPackagePool: '++id, userId, consumed',
        plaintextCache: 'ciphertext',
      })
      .upgrade((tx) =>
        tx
          .table('keyPackagePool')
          .toCollection()
          .modify((kp: StoredKeyPackage & { consumed: unknown }) => {
            kp.consumed = kp.consumed ? 1 : 0
          }),
      )
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
  deviceId: string,
): Promise<void> {
  await db.identity.put({ userId, signKey, publicKey, deviceId })
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
    consumed: 0,
    createdAt: new Date(),
  })
}

export async function countUnconsumedKeyPackages(userId: string): Promise<number> {
  return db.keyPackagePool.where({ userId, consumed: 0 }).count()
}

/** Every locally-held unconsumed KeyPackage private half, newest first — used
 * to find the one a Welcome was actually encrypted against (see session.ts
 * joinFromWelcome: ts-mls doesn't expose a cheap way to inspect a Welcome's
 * intended recipient ahead of time, so we try candidates until one works). */
export async function unconsumedKeyPackages(userId: string): Promise<StoredKeyPackage[]> {
  const rows = await db.keyPackagePool.where({ userId, consumed: 0 }).toArray()
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

export async function markKeyPackageConsumed(id: number): Promise<void> {
  await db.keyPackagePool.update(id, { consumed: 1 })
}

export async function pruneConsumedKeyPackages(userId: string): Promise<void> {
  await db.keyPackagePool.where({ userId, consumed: 1 }).delete()
}

// ─── Plaintext cache ───────────────────────────────────────────────────────
// MLS application-message ratchets are forward-secret: every ciphertext can
// be turned into plaintext EXACTLY ONCE per client, because doing so
// consumes/advances that message's ratchet generation. This applies in both
// directions:
//
//   - Sending: encryptForChannel advances our own sender ratchet, so we can
//     never decrypt our own message when the server echoes it back.
//   - Receiving: the first successful decrypt advances the sender's receiver
//     ratchet on our side, so a second attempt at the same ciphertext fails.
//
// Either way ts-mls correctly rejects the repeat attempt with a "Desired gen
// in the past" error. That makes this cache load-bearing, not an
// optimization: without it a simple re-render, a scroll away and back, or a
// page reload would permanently render already-received messages
// undecryptable. So we persist the plaintext keyed by the exact ciphertext
// string stored in `messages.content` the moment we have it — on encrypt for
// sent messages, on first successful decrypt for received ones. See
// MLSContext.tsx, the only caller.
//
// Note this means message plaintext lives in IndexedDB, matching how the
// private key material in the tables above is already stored (see the
// at-rest caveat in this file's header).

export async function savePlaintext(ciphertext: string, plaintext: string): Promise<void> {
  await db.plaintextCache.put({ ciphertext, plaintext, createdAt: new Date() })
}

export async function loadPlaintext(ciphertext: string): Promise<string | null> {
  const row = await db.plaintextCache.get(ciphertext)
  return row?.plaintext ?? null
}

export type { StoredKeyPackage }
