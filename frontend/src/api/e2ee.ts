import apiClient from './client'

// ─── Types ─────────────────────────────────────────────────────────────────

export type QRSessionStatus = 'pending' | 'scanned' | 'approved' | 'expired' | 'used'

export interface QRChallengeResponse {
  session_id: string
  device_ephemeral_pk: string
  expires_at: string
}

export interface QRStatusResponse {
  session_id: string
  status: QRSessionStatus
  // Only present when status === "approved"
  access_token?: string
  refresh_token?: string
  encrypted_private_key?: string
  encryption_nonce?: string
  approver_e2ee_public_key?: string
}

export interface E2EEPublicKeyRead {
  user_id: string
  public_key: string
  fingerprint: string
  updated_at: string
}

// ─── QR session ────────────────────────────────────────────────────────────

/**
 * Create a new QR login session on the server.
 * Called by the NEW (untrusted) device.
 *
 * @param deviceEphemeralPk  Base64 SPKI of the new device's ephemeral ECDH public key
 */
export async function createQRChallenge(deviceEphemeralPk: string): Promise<QRChallengeResponse> {
  const { data } = await apiClient.post('/auth/qr/challenge', {
    device_ephemeral_pk: deviceEphemeralPk,
  })
  return data
}

/**
 * Poll the status of a QR session.
 * Called by the NEW device every ~2 s until status is "approved" or "expired".
 */
export async function pollQRStatus(sessionId: string): Promise<QRStatusResponse> {
  const { data } = await apiClient.get(`/auth/qr/${sessionId}/status`)
  return data
}

/**
 * Approve a QR login session from the trusted (phone) device.
 *
 * @param sessionId             The session ID from the QR payload
 * @param encryptedPrivateKey   AES-GCM ciphertext of the user's E2EE private key
 * @param encryptionNonce       AES-GCM IV (nonce)
 * @param approverE2eePublicKey Approver's E2EE ECDH public key (SPKI base64)
 */
export async function approveQRSession(
  sessionId: string,
  encryptedPrivateKey: string,
  encryptionNonce: string,
  approverE2eePublicKey: string,
): Promise<QRStatusResponse> {
  const { data } = await apiClient.post(`/auth/qr/${sessionId}/approve`, {
    encrypted_private_key: encryptedPrivateKey,
    encryption_nonce: encryptionNonce,
    approver_e2ee_public_key: approverE2eePublicKey,
  })
  return data
}

// ─── E2EE public key management ────────────────────────────────────────────

/** Upload/rotate your own E2EE public key. */
export async function publishPublicKey(publicKey: string, fingerprint: string): Promise<E2EEPublicKeyRead> {
  const { data } = await apiClient.put('/me/e2ee-public-key', { public_key: publicKey, fingerprint })
  return data
}

/** Fetch another user's E2EE public key (to encrypt a DM for them). */
export async function getUserPublicKey(userId: string): Promise<E2EEPublicKeyRead | null> {
  try {
    const { data } = await apiClient.get(`/users/${userId}/e2ee-public-key`)
    return data
  } catch (err: any) {
    if (err?.response?.status === 404) return null
    throw err
  }
}
