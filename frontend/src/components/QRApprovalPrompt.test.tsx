import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const getQRSessionInfo = vi.fn()
vi.mock('../api/e2ee', () => ({ getQRSessionInfo: (id: string) => getQRSessionInfo(id) }))

import { QRApprovalPrompt } from './QRApprovalPrompt'

const info = {
  session_id: 's1',
  requester_ip: '203.0.113.7',
  requester_user_agent: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  same_network: true,
  created_at: '2026-11-26T10:00:00Z',
  expires_at: '2026-11-26T10:02:00Z',
}

describe('QRApprovalPrompt', () => {
  beforeEach(() => {
    getQRSessionInfo.mockReset()
  })

  it('shows where the request came from and needs confirmation before approving', async () => {
    getQRSessionInfo.mockResolvedValue(info)
    const onApprove = vi.fn()
    render(<QRApprovalPrompt sessionId="s1" onApprove={onApprove} onCancel={vi.fn()} />)

    expect(await screen.findByText('Firefox on Linux')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.7')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()

    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve).toBeDisabled()
    fireEvent.click(approve)
    expect(onApprove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(approve)
    expect(onApprove).toHaveBeenCalledOnce()
  })

  it('warns when the request comes from a different network', async () => {
    getQRSessionInfo.mockResolvedValue({ ...info, same_network: false })
    render(<QRApprovalPrompt sessionId="s1" onApprove={vi.fn()} onCancel={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('different network')
  })

  it('shows the server error for an expired or used code', async () => {
    const err = Object.assign(new Error('404'), { response: { data: { detail: 'QR session not found or expired' } } })
    getQRSessionInfo.mockImplementation(() => Promise.reject(err))
    render(<QRApprovalPrompt sessionId="s1" onApprove={vi.fn()} onCancel={vi.fn()} />)
    expect(await screen.findByText('QR session not found or expired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })
})
