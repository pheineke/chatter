import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UnreadChannelsProvider, useUnreadChannels } from './UnreadChannelsContext'

function Consumer() {
  const { unreadChannels, unreadServers, notifyMessage, markRead, notifyServer, markServerRead } = useUnreadChannels()
  return (
    <div>
      <span data-testid="channels">{[...unreadChannels].join(',')}</span>
      <span data-testid="servers">{[...unreadServers].join(',')}</span>
      <button onClick={() => notifyMessage('chan-1')}>notify chan-1</button>
      <button onClick={() => notifyMessage('chan-2')}>notify chan-2</button>
      <button onClick={() => markRead('chan-1')}>mark chan-1</button>
      <button onClick={() => notifyServer('srv-1')}>notify srv-1</button>
      <button onClick={() => markServerRead('srv-1')}>mark srv-1</button>
    </div>
  )
}

function renderConsumer() {
  return render(
    <UnreadChannelsProvider>
      <Consumer />
    </UnreadChannelsProvider>,
  )
}

describe('UnreadChannelsProvider — channels', () => {
  it('starts with empty unread set', () => {
    renderConsumer()
    expect(screen.getByTestId('channels').textContent).toBe('')
  })

  it('notifyMessage adds a channel to the unread set', async () => {
    const user = userEvent.setup()
    renderConsumer()
    await user.click(screen.getByText('notify chan-1'))
    expect(screen.getByTestId('channels').textContent).toBe('chan-1')
  })

  it('notifyMessage is idempotent', async () => {
    const user = userEvent.setup()
    renderConsumer()
    await user.click(screen.getByText('notify chan-1'))
    await user.click(screen.getByText('notify chan-1'))
    expect(screen.getByTestId('channels').textContent).toBe('chan-1')
  })

  it('markRead removes the channel from the unread set', async () => {
    const user = userEvent.setup()
    renderConsumer()
    await user.click(screen.getByText('notify chan-1'))
    expect(screen.getByTestId('channels').textContent).toBe('chan-1')

    await user.click(screen.getByText('mark chan-1'))
    expect(screen.getByTestId('channels').textContent).toBe('')
  })

  it('markRead is a no-op when channel is already read', async () => {
    const user = userEvent.setup()
    renderConsumer()
    // Should not throw
    await user.click(screen.getByText('mark chan-1'))
    expect(screen.getByTestId('channels').textContent).toBe('')
  })

  it('tracks multiple unread channels', async () => {
    const user = userEvent.setup()
    renderConsumer()
    await user.click(screen.getByText('notify chan-1'))
    await user.click(screen.getByText('notify chan-2'))
    const channels = screen.getByTestId('channels').textContent!.split(',')
    expect(channels).toContain('chan-1')
    expect(channels).toContain('chan-2')
  })
})

describe('UnreadChannelsProvider — servers', () => {
  it('starts with empty unread servers set', () => {
    renderConsumer()
    expect(screen.getByTestId('servers').textContent).toBe('')
  })

  it('notifyServer adds a server to the unread set', async () => {
    const user = userEvent.setup()
    renderConsumer()
    await user.click(screen.getByText('notify srv-1'))
    expect(screen.getByTestId('servers').textContent).toBe('srv-1')
  })

  it('notifyServer is idempotent', async () => {
    const user = userEvent.setup()
    renderConsumer()
    await user.click(screen.getByText('notify srv-1'))
    await user.click(screen.getByText('notify srv-1'))
    expect(screen.getByTestId('servers').textContent).toBe('srv-1')
  })

  it('markServerRead removes the server from the unread set', async () => {
    const user = userEvent.setup()
    renderConsumer()
    await user.click(screen.getByText('notify srv-1'))
    await user.click(screen.getByText('mark srv-1'))
    expect(screen.getByTestId('servers').textContent).toBe('')
  })
})
