import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { INSECURE_MEDIA_MESSAGE } from '../utils/media'

const voiceState = {
  participants: [],
  isMuted: false,
  isDeafened: false,
  isSharingScreen: false,
  isSharingWebcam: false,
  mediaError: null as string | null,
}

vi.mock('../contexts/VoiceCallContext', () => ({
  useVoiceCall: () => ({
    state: voiceState,
    toggleMute: vi.fn(),
    toggleDeafen: vi.fn(),
    toggleScreenShare: vi.fn(),
    toggleWebcam: vi.fn(),
  }),
}))

import { VoiceChannelBar } from './VoiceChannelBar'

const session = { channelId: 'c1', channelName: 'General', serverId: 's1' }

function renderBar() {
  return render(
    <MemoryRouter>
      <VoiceChannelBar session={session} onLeave={() => {}} />
    </MemoryRouter>,
  )
}

describe('VoiceChannelBar on an insecure origin (plain HTTP on a LAN IP)', () => {
  let original: PropertyDescriptor | undefined

  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    // What browsers expose outside a secure context.
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    voiceState.mediaError = null
  })

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'mediaDevices', original)
    else delete (navigator as unknown as Record<string, unknown>).mediaDevices
  })

  it('renders instead of crashing the app', () => {
    // This used to throw "Cannot read properties of undefined (reading
    // 'getUserMedia')" from an effect, which unmounted the whole app.
    expect(() => renderBar()).not.toThrow()
    expect(screen.getByText(/voice connected/i)).toBeInTheDocument()
  })

  it('explains why the microphone is unavailable', () => {
    voiceState.mediaError = INSECURE_MEDIA_MESSAGE
    renderBar()
    expect(screen.getByRole('status')).toHaveTextContent(/HTTPS/)
  })
})
