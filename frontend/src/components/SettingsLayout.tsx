import { useState, useEffect, type ReactNode } from 'react'
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

interface QuickAction {
  icon: string
  label: string
  onClick: () => void
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
  quickActions?: QuickAction[]
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
  quickActions,
}: Props) {
  const all: SettingsGroup[] = groups || (tabs ? [{ id: 'default', label: title, items: tabs }] : [])
  const flat = all.flatMap(g => g.items)
  const activeInfo = flat.find(t => t.id === activeTab)
  const [showList, setShowList] = useState(true)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function renderGroupItems(items: SettingsTab[], rowClick?: (id: string) => void) {
    return items.map(tab => {
      const isActive = activeTab === tab.id
      return (
        <button
          key={tab.id}
          onClick={() => (rowClick || onTabChange)(tab.id)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left
            ${isActive
              ? 'bg-sp-input text-sp-text'
              : tab.danger
                ? 'text-red-400 hover:bg-red-500/10'
                : 'text-sp-muted hover:bg-sp-input/50 hover:text-sp-text'}`}
        >
          <Icon name={tab.icon} size={16} className="shrink-0" />
          <span className="truncate">{tab.label}</span>
        </button>
      )
    })
  }

  function renderGroups(mobile?: boolean) {
    return all.map(group => (
      <div key={group.id} className="px-3 py-4">
        {group.label && (
          <div className="text-xs font-bold text-sp-muted uppercase tracking-wider px-3 mb-2">{group.label}</div>
        )}
        {group.items.length > 0 && renderGroupItems(group.items, mobile ? (id) => { onTabChange(id); setShowList(false) } : undefined)}
      </div>
    ))
  }

  const sidebar = (
    <div className="w-56 shrink-0 border-r border-sp-divider/20 bg-sp-bg overflow-y-auto flex flex-col">
      {renderGroups()}
      {sidebarFooter && (
        <div className="mt-auto px-3 pb-4 pt-4 border-t border-sp-divider/20">
          {sidebarFooter}
        </div>
      )}
      <div className="flex-1" />
    </div>
  )

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full bg-sp-bg">
      {/* Mobile: top bar */}
      <div className="md:hidden shrink-0 flex items-center gap-1 px-4 py-2 border-b border-sp-divider/20 bg-sp-bg">
        <button
          onClick={showList ? onClose : () => setShowList(true)}
          className="p-1 -ml-1 mr-1 text-sp-muted hover:text-sp-text shrink-0"
          aria-label={showList ? 'Close settings' : 'Back'}
        >
          <Icon name={showList ? 'close' : 'arrow-back'} size={20} />
        </button>
        <span className="font-semibold text-sm text-sp-text truncate">
          {showList ? 'Settings' : activeInfo?.label || 'Settings'}
        </span>
        {!showList && (
          <button onClick={onClose} className="ml-auto p-1 text-sp-muted hover:text-sp-text">
            <Icon name="close" size={18} />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Mobile: master view */}
        <div className={`md:hidden flex-1 overflow-y-auto ${showList ? 'block' : 'hidden'}`}>
          {quickActions && quickActions.length > 0 && (
            <div className="px-3 pt-4 pb-2 border-b border-sp-divider/20">
              <div className="text-xs font-bold text-sp-muted uppercase tracking-wider px-3 mb-2">Quick Actions</div>
              <div className="flex flex-wrap gap-2 px-3">
                {quickActions.map((a, i) => (
                  <button
                    key={i}
                    onClick={a.onClick}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sp-input hover:bg-sp-hover text-sm text-sp-text transition-colors"
                  >
                    <Icon name={a.icon} size={16} />
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {renderGroups(true)}
          {sidebarFooter && <div className="px-3 pb-4">{sidebarFooter}</div>}
        </div>

        {/* Desktop: sidebar */}
        <div className="hidden md:block">{sidebar}</div>

        {/* Content */}
        <div className={`flex-1 min-h-0 overflow-y-auto bg-sp-bg ${showList ? 'hidden md:block' : 'block'}`}>
          <div className="max-w-4xl mx-auto p-4 md:p-8 min-h-full flex flex-col">
            {children}
            {sidebarFooter && (
              <div className="mt-8 pt-6 border-t border-sp-divider/20 hidden md:block">
                {sidebarFooter}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}