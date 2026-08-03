/**
 * Link-time message history transfer between a user's own devices.
 *
 * MLS is forward-secret: a device Added to a group at epoch N cannot derive
 * keys for anything sent before it joined, so a newly-linked device sees an
 * empty channel however correct the protocol is. History therefore can't come
 * from MLS — it has to be handed over by a device that already holds the
 * plaintext (the cache in storage.ts), encrypted to the new one.
 *
 * That's the same approach WhatsApp uses for companion devices, and the
 * reason it's preferable to a server-side archive: the bundle is ephemeral
 * and the key for it exists only on the two devices, so no long-lived secret
 * is introduced and the server never holds anything it could read. The one
 * thing it costs is that an existing device has to be online to answer.
 *
 * Encryption reuses crypto/index.ts (ECDH P-256 + AES-GCM), which already
 * does exactly this shape of handover for QR login.
 */
import {
  generateKeyPair,
  exportPublicKey,
  exportPrivateKey,
  importPublicKey,
  importPrivateKey,
  deriveSharedKey,
  encryptMessage,
  decryptMessage,
} from '../crypto'
import * as api from './api'
import * as store from './storage'

/** Messages per batch.
 *
 * History is transferred newest-first, one batch per serving pass, rather
 * than as a single archive: the newly-linked device shows recent conversation
 * almost immediately and fills in older history behind it, and an interrupted
 * transfer resumes rather than restarting. 200 keeps each encrypt/decrypt
 * small enough not to jank the tab and stays well inside the server's
 * per-bundle cap (MAX_HISTORY_BUNDLE_B64 in app/schemas/mls.py).
 */
const ENTRIES_PER_BATCH = 200

/** Batches one serving pass will send per requesting device.
 *
 * Several per pass so a transfer makes real progress while both devices are
 * open, but bounded so a device with a large archive doesn't spend minutes
 * uploading before doing anything else. Whatever's left continues on the next
 * load — the cursor makes that safe.
 */
const BATCHES_PER_PASS = 5

interface HistoryPayload {
  /** Format marker, so a future change can be detected rather than guessed. */
  v: 1
  /** `t` is the original cache timestamp, preserved across the transfer so
   * the receiving device can order and resume correctly. */
  entries: { c: string; p: string; t: string }[]
}

/**
 * Ask this user's other devices for history.
 *
 * Generates a keypair used for this transfer only — deliberately not the MLS
 * signature or init key, since init keys are single-use and consumed by Adds,
 * so borrowing one would interfere with joining groups. The private half stays
 * local; only the public half is published.
 */
export async function requestHistory(userId: string, deviceId: string): Promise<void> {
  const pair = await generateKeyPair()
  const publicKey = await exportPublicKey(pair.publicKey)
  await store.saveTransferKeyPair(userId, await exportPrivateKey(pair.privateKey), publicKey)
  await api.requestHistory(deviceId, publicKey)
}

/**
 * Answer any of this user's other devices that are waiting for history.
 *
 * Called opportunistically by a device that holds plaintext. Skips our own
 * device id (we can't usefully send history to ourselves) and does nothing
 * when there's nothing cached yet, so a device that has itself just been
 * linked doesn't send empty bundles.
 *
 * Returns the number of devices served, for logging.
 */
export async function servePendingHistoryRequests(ownDeviceId: string): Promise<number> {
  const requests = (await api.fetchHistoryRequests()).filter((r) => r.deviceId !== ownDeviceId)
  if (requests.length === 0) return 0

  let batchesSent = 0
  for (const request of requests) {
    try {
      // Walk backwards from wherever this device got to. A device that has
      // never synced starts at the newest message.
      let cursor = request.syncedBefore
      const first = await store.plaintextOlderThan(cursor, 1)
      if (first.length === 0) {
        // Nothing older to give: either we hold no history at all (we may be
        // a freshly-linked device ourselves), or this device already has
        // everything we do. Only retire the request in the latter case —
        // withdrawing it while empty-handed would tell the requester the
        // transfer is finished when a device that actually holds history
        // hasn't had its turn.
        const anything = await store.plaintextOlderThan(null, 1)
        if (anything.length > 0 && cursor !== null) await api.deleteHistoryRequest(request.deviceId)
        continue
      }

      const theirPublicKey = await importPublicKey(request.publicKey)
      // A fresh ephemeral keypair per recipient: the shared secret is derived
      // from it and their published key, so nothing about this transfer is
      // reusable for another one.
      const ourPair = await generateKeyPair()
      const sharedKey = await deriveSharedKey(ourPair.privateKey, theirPublicKey)
      const ourPublicKey = await exportPublicKey(ourPair.publicKey)

      for (let batch = 0; batch < BATCHES_PER_PASS; batch++) {
        const entries = await store.plaintextOlderThan(cursor, ENTRIES_PER_BATCH)
        if (entries.length === 0) break

        const payload: HistoryPayload = {
          v: 1,
          entries: entries.map((e) => ({
            c: e.ciphertext,
            p: e.plaintext,
            t: e.createdAt.toISOString(),
          })),
        }
        const { ciphertext, nonce } = await encryptMessage(sharedKey, JSON.stringify(payload))
        await api.uploadHistoryBundle({
          targetDeviceId: request.deviceId,
          senderDeviceId: ownDeviceId,
          senderPublicKey: ourPublicKey,
          ciphertext,
          nonce,
        })
        batchesSent += 1
        // entries are newest-first, so the last one is the oldest we just
        // sent — the next batch continues from there.
        cursor = entries[entries.length - 1].createdAt
      }
    } catch (err) {
      // One unreachable or malformed request shouldn't stop us serving the
      // others; the requesting device retries on its next load anyway.
      console.warn('[MLS] could not serve history to', request.deviceId, err)
    }
  }
  return batchesSent
}

/**
 * Collect and import any history sent to this device.
 *
 * Returns the number of messages recovered. Bundles are deleted as they're
 * imported, which is what keeps the server a relay rather than an archive;
 * the transfer key is dropped once everything has arrived, since it exists
 * only to decrypt this one handover.
 */
export async function collectHistory(userId: string, deviceId: string): Promise<number> {
  const keys = await store.loadTransferKeyPair(userId)
  if (!keys) return 0 // never asked, or already finished and cleaned up

  const bundles = await api.fetchHistoryBundles(deviceId)
  if (bundles.length === 0) {
    // No bundles and no outstanding request means a serving device has told
    // us there's nothing older left, so the transfer is complete and the key
    // has no further use.
    const stillWanted = (await api.fetchHistoryRequests()).some((r) => r.deviceId === deviceId)
    if (!stillWanted) await store.clearTransferKeyPair(userId)
    return 0
  }

  const ourPrivateKey = await importPrivateKey(keys.privateKey)
  let imported = 0
  let oldestSeen: Date | null = null

  for (const bundle of bundles) {
    try {
      const theirPublicKey = await importPublicKey(bundle.senderPublicKey)
      const sharedKey = await deriveSharedKey(ourPrivateKey, theirPublicKey)
      // Returns null rather than throwing on a failed AES-GCM tag check, so
      // this has to be tested explicitly — the catch below would never see it.
      const json = await decryptMessage(sharedKey, bundle.ciphertext, bundle.nonce)
      if (json === null) {
        console.warn('[MLS] history bundle failed authentication, leaving it for retry', bundle.id)
        continue
      }
      const payload = JSON.parse(json) as HistoryPayload
      if (payload.v !== 1) {
        console.warn('[MLS] unknown history bundle version', payload.v)
        continue
      }

      const entries = payload.entries.map((e) => ({
        ciphertext: e.c,
        plaintext: e.p,
        // Preserve the sending device's timestamp rather than stamping "now":
        // it's what orders history sync, so flattening it would break both
        // ordering and the resume cursor on this device.
        createdAt: new Date(e.t),
      }))
      await store.importPlaintext(entries)
      imported += entries.length
      for (const e of entries) {
        if (oldestSeen === null || e.createdAt < oldestSeen) oldestSeen = e.createdAt
      }
      await api.consumeHistoryBundle(bundle.id)
    } catch (err) {
      // Leave the bundle in place: a decrypt failure here is worth another
      // attempt on next load rather than silently discarding the only copy
      // of this history that will ever be offered.
      console.warn('[MLS] could not import history bundle', bundle.id, err)
    }
  }

  // Re-announce with the cursor moved back, so the next serving pass — this
  // session or a later one, from this device or another — continues from
  // where we got to instead of resending what already arrived. The request
  // stays open until a serving device retires it, which is how we learn
  // there's genuinely nothing older left.
  if (oldestSeen !== null) {
    await api.requestHistory(deviceId, keys.publicKey, oldestSeen)
  }

  return imported
}
