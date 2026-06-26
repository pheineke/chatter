import { useEffect, type ReactNode } from 'react'
import { Icon } from './Icon'

export interface SettingsTab {
  id: string
  label: string
  icon: string
  danger?: boolean
}

export interface SettingsGroup {
  id: string
  label?: string
  items: SettingsTab[]
}

interface Props {
  activeTab: string
  onTabChange: (tabId: string) => void
  onClose: () => void
  children: ReactNode
  sidebarFooter?: ReactNode
  groups?: SettingsGroup[]
  tabs?: SettingsTab[]
  title?: string
}

export function SettingsLayout({
  title,
  tabs,
  groups,
  activeTab,
  onTabChange,
  onClose,
  children,
  sidebarFooter,
}: Props) {
  const all: SettingsGroup[] = groups || (tabs ? [{ id: 'default', label: title, items: tabs }] : [])
  const flat = all.flatMap(g => g.items)
  const activeInfo = flat.find(t => t.id === activeTab)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full bg-sp-bg">
      {/* Tab bar */}
      <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-sp-divider/20 overflow-x-auto bg-sp-bg">
        <button onClick={onClose}
          className="p-1 -ml-1 mr-1 text-sp-muted hover:text-sp-text shrink-0"
          aria-label="Close settings"
        >
          <Icon name="close" size={20} />
        </button>
        {flat.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button key={tab.id} onClick={() => onTabChange(tab.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors whitespace-nowrap
                ${isActive
                  ? 'bg-sp-input text-sp-text'
                  : tab.danger
                    ? 'text-red-400 hover:bg-red-500/10'
                    : 'text-sp-muted hover:bg-sp-input/50 hover:text-sp-text'}`}
            >
              <Icon name={tab.icon} size={16} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 md:p-8 min-h-full flex flex-col">
          {children}
          {sidebarFooter && (
            <div className="mt-8 pt-6 border-t border-sp-divider/20">
              {sidebarFooter}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}