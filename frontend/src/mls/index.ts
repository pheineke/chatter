/**
 * Public surface for MLS (RFC 9420) group encryption.
 *
 * This is the ONLY module the rest of the app should import from `src/mls`.
 * Everything here works in plain strings/booleans/numbers/Uint8Array — no
 * ts-mls types leak past this boundary. That's deliberate: ts-mls is the
 * most complete TypeScript MLS implementation available today but has no
 * formal security audit yet, so keeping the dependency contained here means
 * swapping it for an audited alternative later only touches session.ts and
 * storage.ts, not MessageInput/MessageBubble/E2EEContext/etc.
 */
export {
  CIPHERSUITE_NAME,
  ensureIdentity,
  topUpKeyPackages,
  hasLocalGroupState,
  remoteGroupExists,
  resetLocalGroup,
  getGroupEpoch,
  createGroupAsFounder,
  syncGroup,
  addMemberToGroup,
  removeMemberFromGroup,
  encryptForChannel,
  decryptFromChannel,
} from './session'
