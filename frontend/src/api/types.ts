// Shared TypeScript types mirroring the backend Pydantic schemas

export type UserStatus = 'online' | 'away' | 'dnd' | 'offline'
export type DMPermission = 'everyone' | 'friends_only' | 'server_members_only'

export interface User {
  id: string
  username: string
  avatar: string | null
  banner: string | null
  description: string | null
  pronouns: string | null
  status: UserStatus
  preferred_status: UserStatus
  dm_permission: DMPermission
  hide_status: boolean
  created_at: string
}

export interface Token {
  access_token: string
  token_type: string
}

// ---- Servers ---------------------------------------------------------------

export interface Server {
  id: string
  title: string
  description: string | null
  image: string | null
  banner: string | null
  owner_id: string
  created_at: string
}

export interface Role {
  id: string
  server_id: string
  name: string
  color: string | null
  is_admin: boolean
  hoist: boolean
  mentionable: boolean
  position: number
}

export interface Member {
  user_id: string
  server_id: string
  joined_at: string
  nickname: string | null
  user: User
  roles: Role[]
}

// ---- Channels --------------------------------------------------------------

export type ChannelType = 'text' | 'voice' | 'dm'

/** Bitfield constants for ChannelPermission.allow_bits / deny_bits. */
export const ChannelPerm = {
  VIEW_CHANNEL:        1 << 0,   //   1
  SEND_MESSAGES:       1 << 1,   //   2
  MANAGE_MESSAGES:     1 << 2,   //   4
  ATTACH_FILES:        1 << 3,   //   8
  EMBED_LINKS:         1 << 4,   //  16
  ADD_REACTIONS:       1 << 5,   //  32
  MENTION_EVERYONE:    1 << 6,   //  64
  USE_EXTERNAL_EMOJIS: 1 << 7,   // 128
  MANAGE_ROLES:        1 << 8,   // 256
} as const

export interface ChannelPermission {
  channel_id: string
  role_id: string
  /** Bitfield of explicitly-allowed permissions (see ChannelPerm). */
  allow_bits: number
  /** Bitfield of explicitly-denied permissions (see ChannelPerm). */
  deny_bits: number
}

export interface Channel {
  id: string
  server_id: string
  title: string
  description: string | null
  type: ChannelType
  position: number
  category_id: string | null
  slowmode_delay: number  // seconds; 0 = disabled
  nsfw: boolean
  user_limit: number | null  // voice: max concurrent users; null = unlimited
  bitrate: number | null     // voice: audio bitrate in bps; null = server default
}

export interface Category {
  id: string
  server_id: string
  title: string
  position: number
}

// ---- Messages --------------------------------------------------------------

export interface Attachment {
  id: string
  file_path: string
  file_type: string
  filename: string | null
  file_size: number | null
  width: number | null
  height: number | null
}

export interface Reaction {
  id: string
  emoji: string
  user_id: string
}

export interface MentionInfo {
  id: string
  mentioned_user_id: string | null
  mentioned_role_id: string | null
  mentioned_username: string | null
  mentioned_role_name: string | null
}

export interface MessageReply {
  id: string
  content: string
  is_deleted: boolean
  author: User
}

export interface Message {
  id: string
  channel_id: string
  content: string | null
  author: User
  author_nickname: string | null
  reply_to_id: string | null
  reply_to: MessageReply | null
  is_deleted: boolean
  is_edited: boolean
  edited_at: string | null
  created_at: string
  attachments: Attachment[]
  reactions: Reaction[]
  mentions: MentionInfo[]
}

export interface PinnedMessage {
  id: string
  pinned_at: string
  pinned_by: User
  message: Message
}

// ---- DMs -------------------------------------------------------------------

export interface DMConversation {
  channel_id: string
  other_user: User
  last_message_at: string | null
}

// ---- Friends ---------------------------------------------------------------

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined'

export interface FriendRequest {
  id: string
  sender: User
  recipient: User
  status: FriendRequestStatus
  created_at: string
}

export interface Friend {
  user: User
}

// ---- Voice -----------------------------------------------------------------

export interface VoiceParticipant {
  user_id: string
  username: string
  avatar: string | null
  is_muted: boolean
  is_deafened: boolean
  is_sharing_screen: boolean
  is_sharing_webcam: boolean
  is_speaking: boolean
}
