/**
 * Client-side upload limits. Mirrors backend/app/config.py (max_upload_size).
 * The server enforces these regardless; checking here just gives a clear
 * message before anything is sent.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

/** Returns an error message if *file* is over the limit, otherwise null. */
export function uploadSizeError(file: File, maxBytes = MAX_UPLOAD_BYTES): string | null {
  if (file.size <= maxBytes) return null
  const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `"${file.name}" is ${mb(file.size)}; the limit is ${mb(maxBytes)}.`
}
