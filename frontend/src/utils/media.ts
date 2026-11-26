/**
 * Camera, microphone and screen-share APIs only exist in a secure context:
 * HTTPS, or http://localhost. Opened over plain HTTP on a LAN address
 * (http://192.168.x.x:9090) `navigator.mediaDevices` is undefined, so any
 * unguarded `navigator.mediaDevices.getUserMedia(...)` throws a TypeError —
 * inside a React effect that used to unmount the whole app (blank screen).
 */

/** The MediaDevices API, or null where the browser doesn't offer it. */
export function getMediaDevices(): MediaDevices | null {
  if (typeof navigator === 'undefined') return null
  return navigator.mediaDevices ?? null
}

export const INSECURE_MEDIA_MESSAGE =
  'Your browser only allows microphone and camera access over HTTPS (or on localhost). ' +
  'Open this site via https:// to talk; you can still listen.'

export const MIC_DENIED_MESSAGE =
  'Microphone access was blocked. Allow it in your browser’s site settings to talk; you can still listen.'

/** Why the microphone can't be used here, or null if it should work. */
export function mediaUnavailableReason(): string | null {
  return getMediaDevices() ? null : INSECURE_MEDIA_MESSAGE
}
