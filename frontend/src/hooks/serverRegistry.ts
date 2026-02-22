/**
 * Module-level set of server IDs for which the client has an active
 * server WebSocket subscription (via useServerWS).
 *
 * useUnreadDMs reads this to avoid double-notifying: if the user is already
 * subscribed to a server's WS, useServerWS handles channel.message events
 * for that server; the personal /ws/me handler should skip them.
 */
export const activeServerIds = new Set<string>()
