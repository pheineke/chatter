import client from './client'

export type NotificationLevel = 'all' | 'mentions' | 'mute'

export interface NotificationSettings {
  channels: Record<string, NotificationLevel>
  servers: Record<string, NotificationLevel>
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const { data } = await client.get<NotificationSettings>('/me/notification-settings')
  return data
}

export async function setChannelNotification(
  channelId: string,
  level: NotificationLevel,
): Promise<void> {
  await client.put(`/me/notification-settings/channels/${channelId}`, { level })
}

export async function setServerNotification(
  serverId: string,
  level: NotificationLevel,
): Promise<void> {
  await client.put(`/me/notification-settings/servers/${serverId}`, { level })
}
