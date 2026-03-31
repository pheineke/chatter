import type { CustomEmoji } from '../api/types'

const CUSTOM_EMOJI_TOKEN_RE = /^:ce:([0-9a-fA-F-]{36}):$/
const CUSTOM_EMOJI_INLINE_RE = /:ce:([0-9a-fA-F-]{36}):/g

export function asCustomEmojiToken(emojiId: string): string {
  return `:ce:${emojiId}:`
}

export function parseCustomEmojiToken(token: string): string | null {
  const match = token.match(CUSTOM_EMOJI_TOKEN_RE)
  if (!match) return null
  return match[1]
}

export function replaceCustomEmojiTokens(text: string, byId: Map<string, CustomEmoji>): string {
  return text.replace(CUSTOM_EMOJI_INLINE_RE, (full, id: string) => {
    const emoji = byId.get(id)
    if (!emoji) return full
    return `![${emoji.name}](/api/static/${emoji.image_path})`
  })
}
