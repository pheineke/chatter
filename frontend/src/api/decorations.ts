import client from './client'

export interface FrameEntry {
  frame_id: string
}

export interface GeneratedCode {
  code: string
  frame_id: string
}

/** Get the list of frame IDs the current user has unlocked. */
export async function getMyDecorations(): Promise<FrameEntry[]> {
  const { data } = await client.get<FrameEntry[]>('/decorations/me')
  return data
}

/** Redeem a decoration code to unlock a frame. */
export async function redeemDecorationCode(code: string): Promise<FrameEntry> {
  const { data } = await client.post<FrameEntry>('/decorations/redeem', { code })
  return data
}

/** Generate decoration codes (dev/admin). */
export async function generateDecorationCodes(frameId: string, count = 1): Promise<GeneratedCode[]> {
  const { data } = await client.post<GeneratedCode[]>('/decorations/generate', { frame_id: frameId, count })
  return data
}
