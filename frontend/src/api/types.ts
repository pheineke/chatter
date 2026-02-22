// Shared TypeScript types mirroring the backend Pydantic schemas

export type UserStatus = 'online' | 'away' | 'busy' | 'offline'

export interface User {
  id: string
  username: string
  avatar: string | null
  banner: string | null
  description: string | null
  pronouns: string | null
  status: UserStatus
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
  position: number
}

export interface Member {
  user_id: string
  server_id: string
  joined_at: string
  user: User
  roles: Role[]
}

// ---- Channels --------------------------------------------------------------

export type ChannelType = 'text' | 'voice'

export interface Channel {
  id: string
  server_id: string
  title: string
  description: string | null
  type: ChannelType
  position: number
  category_id: string | null
  slowmode_delay: number  // seconds; 0 = disabled
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
  content: string
  author: User
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

export interface DM {
  id: string
  sender: User
  recipient: User
  content: string
  is_deleted: boolean
  created_at: string
  attachments: Attachment[]
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
