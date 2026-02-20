# Client Sounds Specification

## 1. Overview
This specification details the integration of sound effects for user actions and notifications within the client application. These sounds provide auditory feedback for critical interactions like voice channel events, mute status toggles, and incoming messages.

## 2. Asset Mapping

All sound files are located in `frontend/public/sounds/`.

| Event Type | Sound File | Description |
| :--- | :--- | :--- |
| **Channel Join** | `discord-join.mp3` | Played when a user (self or other) joins the current voice channel. |
| **Channel Leave** | `discord-leave.mp3` | Played when a user (self or other) leaves the current voice channel. |
| **Mute (Self)** | `discord-mute.mp3` | Played when the local user mutes their microphone. |
| **Unmute (Self)** | `discord-unmute.mp3` | Played when the local user unmutes their microphone. |
| **Deafen (Self)** | `discord-deafen.mp3` | Played when the local user deafens their audio. |
| **Undeafen (Self)** | `discord-undeafen.mp3` | Played when the local user undeafens their audio. |
| **Message Notification** | `discord-notification.mp3` | Played when a new message is received in a channel other than the active one, or when the window is unfocused. |
| **Incoming Call** | `discord-call-sound.mp3` | (Future) Ringtone for incoming direct voice calls. |

## 3. Implementation Logic

### 3.1. Audio Playback
- Use the standard HTML5 `Audio` API.
- Sounds should be preloaded or cached to ensure low latency.
- **Volume**: Sounds should obey a master "Notification Volume" setting (default: 100%).

### 3.2. Event Triggers

#### Voice Channel Events
- **Scope**: Listen to WebSocket events for `voice_state_update`.
- **Condition (Join/Leave)**:
  - Play `discord-join.mp3` when a user `session_id` appears in the participant list for the *currently active* voice channel.
  - Play `discord-leave.mp3` when a user `session_id` is removed from the participant list of the *currently active* voice channel.
- **Exceptions**:
  - Do **not** play join sound on initial load of the participant list (only for real-time updates).

#### Local Toggle Events
- **Scope**: Triggered by user interaction with Mic/Headphone buttons in `VoiceChannelBar` or `VoiceGridPane`.
- **Condition**:
  - Play `discord-mute.mp3` / `discord-unmute.mp3` immediately upon clicking the toggle.
  - Play `discord-deafen.mp3` / `discord-undeafen.mp3` immediately upon clicking the toggle.
- **Debounce**: Ensure rapid clicking doesn't stack audio playback unpleasantly (e.g., stop previous sound before playing new one, or limit rate).

#### Message Notifications
- **Scope**: Listen to WebSocket events for `message_create`.
- **Condition**:
  - IF message author != local user
  - AND (Current Channel != Message Channel OR Window is not focused)
  - THEN Play `discord-notification.mp3`

### 3.3. Settings Integration
The playing of these sounds must respect the user's preferences defined in the Settings page (see `settings_page_spec.md`).

- Check `userSettings.sounds.join` before playing `discord-join.mp3`.
- Check `userSettings.sounds.leave` before playing `discord-leave.mp3`.
- Check `userSettings.sounds.mute` before playing mute/unmute sounds.
- Check `userSettings.sounds.deafen` before playing deafen/undeafen sounds.

## 4. Technical Requirements

- **Global Sound Manager**: Implement a centralized `SoundManager` utility or React Context to handle loading and playing of assets. This ensures volume settings are applied globally and prevents asset duplication.
- **Format**: MP3 (supported by all modern browsers).
