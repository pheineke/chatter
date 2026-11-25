import { describe, it, expect } from 'vitest'
import { MAX_UPLOAD_BYTES, uploadSizeError } from './uploads'

const fileOf = (size: number, name = 'f.bin') => new File([new Uint8Array(size)], name)

describe('uploadSizeError', () => {
  it('accepts files up to the limit', () => {
    expect(uploadSizeError(fileOf(MAX_UPLOAD_BYTES))).toBeNull()
  })
  it('rejects larger files with a readable message', () => {
    const msg = uploadSizeError(fileOf(MAX_UPLOAD_BYTES + 1, 'big.zip'))
    expect(msg).toContain('big.zip')
    expect(msg).toContain('8.0 MB')
  })
})
