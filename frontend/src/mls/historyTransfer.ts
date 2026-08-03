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

/** Cache entries per bundle.
 *
 * The user asked for their whole history rather than a recent slice, so this
 * chunks instead of truncating: the server caps a single bundle at ~8 MiB
 * (MAX_HISTORY_BUNDLE_B64 in app/schemas/mls.py) and several bundles per
 * device are expected. 500 messages of ordinary chat is well inside that even
 * after base64 expansion, while keeping any single encrypt/decrypt small
 * enough not to jank the tab.
 */
const ENTRIES_PER_BUNDLE = 500

interface HistoryPayload {
  /** Format marker, so a future change can be detected rather than guessed. */
  v: 1
  entries: { c: string; p: string }[]
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
  await store.saveTransferPrivateKey(userId, await exportPrivateKey(pair.privateKey))
  await api.requestHistory(deviceId, await exportPublicKey(pair.publicKey))
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

  const entries = await store.allPlaintext()
  if (entries.length === 0) return 0

  const payloadChunks: HistoryPayload[] = []
  for (let i = 0; i < entries.length; i += ENTRIES_PER_BUNDLE) {
    payloadChunks.push({
      v: 1,
      entries: entries.slice(i, i + ENTRIES_PER_BUNDLE).map((e) => ({ c: e.ciphertext, p: e.plaintext })),
    })
  }

  let served = 0
  for (const request of requests) {
    try {
      const theirPublicKey = await importPublicKey(request.publicKey)
      // A fresh ephemeral keypair per recipient: the shared secret is derived
      // from it and their published key, so nothing about this transfer is
      // reusable for another one.
      const ourPair = await generateKeyPair()
      const sharedKey = await deriveSharedKey(ourPair.privateKey, theirPublicKey)
      const ourPublicKey = await exportPublicKey(ourPair.publicKey)

      for (const chunk of payloadChunks) {
        const { ciphertext, nonce } = await encryptMessage(sharedKey, JSON.stringify(chunk))
        await api.uploadHistoryBundle({
          targetDeviceId: request.deviceId,
          senderDeviceId: ownDeviceId,
          senderPublicKey: ourPublicKey,
          ciphertext,
          nonce,
        })
      }
      served += 1
    } catch (err) {
      // One unreachable or malformed request shouldn't stop us serving the
      // others; the requesting device retries on its next load anyway.
      console.warn('[MLS] could not serve history to', request.deviceId, err)
    }
  }
  return served
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
  const privateKeyB64 = await store.loadTransferPrivateKey(userId)
  if (!privateKeyB64) return 0 // never asked, or already imported and cleaned up

  const bundles = await api.fetchHistoryBundles(deviceId)
  if (bundles.length === 0) return 0

  const ourPrivateKey = await importPrivateKey(privateKeyB64)
  let imported = 0

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

      await store.importPlaintext(payload.entries.map((e) => ({ ciphertext: e.c, plaintext: e.p })))
      imported += payload.entries.length
      await api.consumeHistoryBundle(bundle.id)
    } catch (err) {
      // Leave the bundle in place: a decrypt failure here is worth another
      // attempt on next load rather than silently discarding the only copy
      // of this history that will ever be offered.
      console.warn('[MLS] could not import history bundle', bundle.id, err)
    }
  }

  if (imported > 0) await store.clearTransferPrivateKey(userId)
  return imported
}
