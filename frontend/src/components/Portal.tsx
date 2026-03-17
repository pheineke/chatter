import { createPortal } from 'react-dom'
import { useEffect, useState, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

export function Portal({ children }: Props) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  return mounted ? createPortal(children, document.body) : null
}