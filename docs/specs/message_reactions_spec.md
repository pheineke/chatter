# Message Reactions Specification

## 1. Overview
Users can express quick sentiment on any message using emoji reactions. Each unique emoji on a message is displayed as a pill showing the emoji and a count. Users can add their own reaction or remove it by clicking the same pill. A full emoji picker is available for browsing the complete emoji set.

---

## 2. Adding a Reaction

### 2.1. Hover Action Bar
Hovering a message reveals the message action bar (top-right). An **Add Reaction** button (😊＋ icon) opens the emoji picker anchored to that message.

### 2.2. Clicking an Existing Reaction Pill
Clicking a reaction pill that the current user has **not** already used adds their reaction.  
Clicking a pill they **have** already used **removes** their reaction (toggle behaviour).

### 2.3. Context Menu
Right-clicking a message exposes a **"Add Reaction"** option that opens the emoji picker.

---

## 3. Emoji Picker

### 3.1. Layout
A floating panel (≈ 360 × 420 px) anchored near the trigger, repositioned if it would overflow the viewport.

```
┌──────────────────────────────────────────┐
│ 🔍  Search emoji…                        │
├──────────────────────────────────────────┤
│ 🕐  ❤️  😂  👍  😢  😮  😡  🎉  …     │  ← Recently Used (up to 36)
├──────────────────────────────────────────┤
│ 😀 Smileys & Emotion                     │
│  😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 …     │
│ 👋 People & Body                         │
│  👋 🤚 🖐 ✋ 🖖 👌 🤏 ✌️ 🤞 …         │
│ 🐶 Animals & Nature                      │
│  …                                       │
│ 🍎 Food & Drink                          │
│  …                                       │
│ ⚽ Activities                            │
│  …                                       │
│ 🌍 Travel & Places                       │
│  …                                       │
│ 💡 Objects                               │
│  …                                       │
│ 🔣 Symbols                              │
│  …                                       │
│ 🚩 Flags                                │
│  …                                       │
└──────────────────────────────────────────┘
```

### 3.2. Category Navigation Bar
A sticky row of category icon buttons above the emoji grid. Clicking a category icon scrolls the grid to that section.

| Icon | Category |
|------|----------|
| 🕐 | Recently Used |
| 😀 | Smileys & Emotion |
| 👋 | People & Body |
| 🐶 | Animals & Nature |
| 🍎 | Food & Drink |
| ⚽ | Activities |
| 🌍 | Travel & Places |
| 💡 | Objects |
| 🔣 | Symbols |
| 🚩 | Flags |

### 3.3. Search
- A text input at the top filters all emoji names/keywords in real-time.
- Results are displayed in a flat "Search Results" section replacing the category grid.
- Empty state: *"No emoji found for '…'"* with a 🔍 icon.
- Clearing the search restores the full categorised grid and scroll position.

### 3.4. Recently Used
- The last **36** distinct emoji used by the current user are stored in `localStorage` under `recentEmoji`.
- They appear in the first section of the picker.
- If the user has no history, this section is hidden.

### 3.5. Emoji Grid
- Each emoji renders as a **36 × 36 px** button with a subtle hover highlight.
- Hovering shows the emoji **name** in a tooltip at the bottom of the picker (e.g. *"thumbs up"*).
- Clicking an emoji: applies the reaction, closes the picker, and prepends the emoji to the Recently Used list.

### 3.6. Skin Tone Modifier
- A skin tone selector button in the top-right corner of the picker (🖐 icon).
- Clicking it opens a small popover with the 6 Fitzpatrick modifier options.
- The selected modifier is persisted in `localStorage` under `emojiSkinTone` and applied by default to all compatible emoji.

### 3.7. Dismissal
The picker closes when:
- An emoji is selected.
- The user clicks outside the picker.
- The user presses **Escape**.

---

## 4. Reaction Pills

### 4.1. Display
Reaction pills are rendered in a wrapping row directly below the message content.

```
[ 👍 12 ]  [ ❤️ 4 ]  [ 😂 1 ]  [ 😊+ ]
```

- **Emoji** + **count** in each pill.
- Pills the current user has reacted to are highlighted (e.g. accented border / tinted background).
- A **＋** "add reaction" mini-button appears at the end of the row (always visible if at least one reaction exists, otherwise only on hover).

### 4.2. Sorting
Reactions are ordered by **count descending**, then by the time the first reaction of that emoji was added (oldest first on ties).

---

## 5. Reaction Tooltip — "Who Reacted"

### 5.1. Trigger
**Hovering** a reaction pill shows a lightweight tooltip after a ~400 ms delay.  
**Right-clicking** a reaction pill opens a persistent **Reactors Popover** (stays open until dismissed).

### 5.2. Hover Tooltip (lightweight)
A small dark tooltip appearing above the pill:

```
┌──────────────────────────┐
│  👍  Liked by            │
│  Josh, Anna, and 3 more  │
└──────────────────────────┘
```

- Shows up to **3 usernames** by display name, then *"and N more"*.
- Disappears when the cursor leaves the pill.

### 5.3. Right-Click Reactors Popover (full list)
A floating panel anchored to the reaction pill:

```
┌─────────────────────────────────┐
│  👍  12 reactions               │
├─────────────────────────────────┤
│  [Avatar] Josh                  │
│  [Avatar] Anna                  │
│  [Avatar] Kai                   │
│  [Avatar] …                     │
│  (scrollable, max height 240px) │
└─────────────────────────────────┘
```

- Displays each reactor's **avatar** (24 px) and **display name**.
- Scrollable if the list exceeds the max height.
- Closes on outside click or **Escape**.
- If the list includes the current user, their row is highlighted and labelled *"You"*.

---

## 6. Data Model

### 6.1. New Table — `message_reaction`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `message_id` | UUID FK → `message` | |
| `user_id` | UUID FK → `user` | |
| `emoji` | VARCHAR(64) | Unicode emoji or `:custom_name:` |
| `created_at` | TIMESTAMP | |

Unique constraint on `(message_id, user_id, emoji)`.

### 6.2. MessageRead Schema Addition
```json
"reactions": [
  {
    "emoji": "👍",
    "count": 12,
    "me": true
  }
]
```

`me` is `true` if the authenticated user has reacted with that emoji.

### 6.3. API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/messages/{id}/reactions/{emoji}` | Add a reaction |
| `DELETE` | `/messages/{id}/reactions/{emoji}` | Remove own reaction |
| `GET` | `/messages/{id}/reactions/{emoji}/users` | List users who used this emoji |

### 6.4. WebSocket Events
| Event | Payload | Description |
|---|---|---|
| `reaction.added` | `{ message_id, emoji, user_id, count }` | Broadcast to channel room |
| `reaction.removed` | `{ message_id, emoji, user_id, count }` | Broadcast to channel room |

Clients patch the in-memory message cache on receipt without a full refetch.

---

## 7. Scope Exclusions
- Custom server emoji in reactions (tracked separately under Server Settings → Emoji).
- Animated emoji (GIF) rendering in the picker (static display only for now).
- Push/toast notifications for reactions.
