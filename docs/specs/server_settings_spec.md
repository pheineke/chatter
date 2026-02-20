# Server Settings Specification

## 1. Overview
The Server Settings page is a centralized dashboard for managing a specific server's configuration, members, and content. It mirrors the layout of the User Settings, with a sidebar for navigation and a main content area for the selected setting.

## 2. Navigation Structure (Sidebar)
The sidebar is divided into categories. The header of the first category is the Server's Name.

### Group 1: [Server Name]
- **Overview** (Default) - Corresponds to "Server Profile"

### Group 2: Expression
- **Emoji**

### Group 3: People
- **Members**
- **Roles**
- **Invites**

### Group 4: Moderation
- **Audit Log** (Organisational activity)
- **Bans**

### Group 5: Advanced
- **Server Template** (Backup/Export)

### Footer / Bottom Actions
- **Delete Server** (Destructive action)
- **Close Button** (X) to return to the server view.

---

## 3. Page Specifications

### 3.1. [Server Name]: Overview (Server Profile)
**Goal:** Manage the server's public identity.

**Features:**
- **Server Name:** Input field to rename the server.
- **Server Icon:** Upload/Remove image (displayed as a circle).
- **Server Banner:** Upload/Remove image (displayed as a rectangular header background).
- **Save Changes:** Button to commit updates.

### 3.2. Expression: Emoji
**Goal:** Manage custom emojis for the server.

**Features:**
- **Emoji Gallery:** Grid view of current custom emojis.
- **Upload Emoji:** Button to upload new image files (PNG/GIF/JPG, max size restriction).
- **Emoji Name:** Input to set the shortcode (e.g., `:my_emoji:`).
- **Delete:** Action to remove an emoji.

### 3.3. People: Members
**Goal:** View and manage the server's population.

**Features:**
- **Member List:** Table displaying:
  - **User:** Avatar + Username.
  - **Roles:** Tags showing assigned roles.
  - **Joined At:** Date/Time the user joined.
  - **Invite Link:** The code/link used to join (if tracked).
- **Search:** Filter members by username.
- **Actions:** context menu to Kick, Ban, or Change Roles.

### 3.4. People: Roles
**Goal:** Define permissions and hierarchy.

**Features:**
- **Role List:** Drag-and-drop list to order roles (hierarchy).
- **Create Role:** Button to add a new role.
- **Role Editor (Right Panel):**
  - **Name:** Input field.
  - **Color:** Color picker for the role's tag and username color.
  - **Permissions:** Toggles for server capabilities (e.g., "Manage Channels", "Kick Members", "Ban Members", "Manage Server").
  - **Channel Permissions:** (Note: specific channel overrides are usually handled in Channel Settings, but this defines global defaults).

### 3.5. People: Invites
**Goal:** Manage active entrance links.

**Features:**
- **Invite List:** Table displaying:
  - **Creator:** User who generated the link.
  - **Code:** The invite code with a copy button.
  - **Uses:** Number of times used (e.g. `3 / 10`, or `5` if unlimited).
  - **Expires:** Remaining time or "Never".
- **Revoke:** Button to delete an invite immediately.
- **Create Invite:** Button/form to generate a new invite with the following options:

#### Expiry Options
Dropdown with fixed presets (default: **1 day**):

| Label    | Value         |
|----------|---------------|
| 1 Hour   | 1 hour        |
| 6 Hours  | 6 hours       |
| 12 Hours | 12 hours      |
| 1 Day    | 24 hours      |
| 7 Days   | 168 hours     |
| Never    | No expiry     |

#### Max Uses Options
Dropdown with fixed presets (default: **No limit**):

| Label    | Value |
|----------|-------|
| No limit | 0     |
| 1 use    | 1     |
| 5 uses   | 5     |
| 10 uses  | 10    |
| 25 uses  | 25    |
| 50 uses  | 50    |
| 100 uses | 100   |

### 3.6. Moderation: Audit Log
**Goal:** Track administrative actions.

**Features:**
- **Activity Feed:** Chronological list of events.
  - Types: Channel Created/Deleted/Edited, Role Created/Updated, Member Kicked/Banned, Invite Created/Revoked, Server Updated.
- **Details:** Who performed the action, what changed (diff view for edits), and when.

### 3.7. Moderation: Bans
**Goal:** Manage denied access.

**Features:**
- **Ban List:** List of banned users.
- **Unban:** Button to revoke a ban, allowing the user to rejoin.
- **Reason:** Display the reason provided at the time of banning.

### 3.8. Advanced: Server Template
**Goal:** Backup and sharing.

**Features:**
- **Generate Template:** Button to export the server structure (Channels, Roles, permissions, Server Settings) into a JSON file.
- **Note:** Does not export chat history, messages, or member list (privacy).

### 3.9. Delete Server
**Goal:** Permanently destroy the community.

**Features:**
- **Delete Button:** Located at the bottom of the sidebar or as a distinct danger zone.
- **Confirmation Modal:**
  - **Warning Text:** Explicitly states this action is irreversible.
  - **Input Challenge:** Requires user to type the exact Server Name to enable the "Delete" confirm button.
