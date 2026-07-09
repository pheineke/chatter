import { createPortal } from 'react-dom'

export function PortalModal({ title, onClose, children, className = 'w-80' }: { title: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  const modalContent = (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className={`bg-sp-popup border border-sp-divider/60 rounded-sp-xl md:p-6 p-5 ${className}`} style={{ boxShadow: 'var(--sp-shadow-3)' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="md:text-lg text-xl font-bold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  )
  return createPortal(modalContent, document.body)
}
