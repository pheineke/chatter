const KEY = (serverId: string) => `lastChannel_${serverId}`

export function getLastChannel(serverId: string): string | null {
  try {
    return localStorage.getItem(KEY(serverId))
  } catch {
    return null
  }
}

export function setLastChannel(serverId: string, channelId: string): void {
  try {
    localStorage.setItem(KEY(serverId), channelId)
  } catch {
    // ignore
  }
}
