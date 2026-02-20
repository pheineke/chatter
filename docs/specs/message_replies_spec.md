# Message Replies Specification

## 1. Overview
Users can reply to any existing message in a text channel or DM. A reply links the new message to the original, rendering a quoted reference above the reply body so readers can follow conversational threads without scrolling.

---

## 2. User Interaction

### 2.1. Triggering a Reply
A reply can be initiated in two ways:

- **Hover Action**: Hovering over a message reveals an action bar (top-right). Clicking the **Reply** icon (↩) on the action bar enters reply mode for that message.
- **Context Menu**: Right-clicking a message opens a context menu with a **"Reply"** option.

### 2.2. Reply Composer State
When reply mode is active, the message input area changes:

- A **reply banner** appears directly above the text input bar, showing:
  - A reply icon (↩) on the left.
  - The text **"Replying to @Username"**.
  - A **✕ close button** on the right to cancel the reply.
- The text input is automatically focused.
- Pressing **Escape** cancels the reply (same as clicking ✕).
- Submitting the message (Enter / Send button) attaches the reply reference to the new message.

---

## 3. Message Display

### 3.1. Quoted Reference (Reply Header)
Messages that are replies render a compact quoted header above the message body:

```
┌─────────────────────────────────────────────┐
│ ↩  [Avatar] Username   preview text…        │
├─────────────────────────────────────────────┤
│ [Avatar] Author                             │
│ The reply message body here.                │
└─────────────────────────────────────────────┘
```

- **Avatar**: Small (16 px) circular avatar of the original message author.
- **Username**: Display name of the original author, styled in a lighter/muted color.
- **Preview text**: A single-line truncated excerpt of the original message content (max ~80 characters, ellipsis if longer).
- **Click to jump**: Clicking the quoted header smoothly scrolls to and briefly highlights the original message. If the original message has been deleted, the header shows *"Original message was deleted"* in muted italic text.

### 3.2. Visual Treatment
- The reply header sits tightly above the author row of the new message, separated by minimal vertical spacing.
- No additional nesting or indentation levels — replies are always flat in the message list (not threaded).
- The original message does **not** change appearance to indicate it has been replied to (to keep the list clean).

---

## 4. Data Model

### 4.1. Message Schema Addition
Each message gains an optional foreign-key reference:

| Field | Type | Description |
|---|---|---|
| `reply_to_id` | `UUID \| null` | ID of the message being replied to |
| `reply_to` | `MessageRead \| null` | Eagerly loaded snapshot of the referenced message (author + content preview) |

The snapshot is loaded at send time so deleted originals still display a tombstone correctly.

### 4.2. API
- `POST /channels/{channel_id}/messages` and `POST /dms/{user_id}/messages` both accept an optional `reply_to_id` field in the request body.
- `GET` message list responses include a populated `reply_to` object when present.

---

## 5. Scope Exclusions
- No threading / nested replies (Discord-style flat list only).
- No reply notifications in this iteration (covered by a future mentions/notifications feature).
- No reply count indicators on the original message.
