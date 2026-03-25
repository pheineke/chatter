import client from './client'
import type { ApplicationCommandRead, InteractionResponse } from './types'

export async function getCommands(serverId?: string): Promise<ApplicationCommandRead[]> {
  const params: Record<string, string> = {}
  if (serverId) params.server_id = serverId
  const { data } = await client.get<ApplicationCommandRead[]>('/commands', { params })
  return data
}

export async function createInteraction(
  commandId: string, 
  name: string, 
  options: Record<string, any> = {},
  serverId?: string,
  channelId?: string
): Promise<InteractionResponse> {
  const { data } = await client.post<InteractionResponse>('/interactions', {
    type: 2, // APPLICATION_COMMAND
    data: {
      id: commandId,
      name,
      type: 1, // CHAT_INPUT
      options: Object.entries(options).map(([k, v]) => ({ name: k, value: v, type: 3 })), // Simplified for now
    },
    server_id: serverId,
    channel_id: channelId,
  })
  return data
}
