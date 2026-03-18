import { useEffect, type ReactNode } from 'react'
import { LayoutShell, NavPanel, ContentPanel } from './LayoutShell'
import { Icon } from './Icon'

export interface SettingsTab {
  id: string
  label: string
  icon: string
  /** If true, renders as red text (e.g. Danger Zone actions, though usually those are in footer) */
  danger?: boolean
}

export interface SettingsGroup {
  id: string
  /** Header text (like "User Settings") */
  label?: string
  items: SettingsTab[]
}

interface CommonProps {
  /** ID of the currently active tab */
  activeTab: string
  /** Callback when a tab is clicked */
  onTabChange: (tabId: string) => void
  /** Callback to close the settings page (e.g. navigate back) */
  onClose: () => void
  /** The main content to render (usually the active tab's content) */
  children: ReactNode
  /** Optional content to render at the bottom of the sidebar (e.g. Delete Server button) */
  sidebarFooter?: ReactNode
}

// Either provide 'groups' OR 'tabs' + 'title'
interface GroupedProps extends CommonProps {
  groups: SettingsGroup[]
  tabs?: never
  title?: never
}

interface FlatProps extends CommonProps {
  groups?: never
  /** The navigation tabs to display */
  tabs: SettingsTab[]
  /** Title shown at the top of the sidebar (e.g. Server Name or "User Settings") */
  title: string
}

type Props = GroupedProps | FlatProps

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
  // Normalize to groups structure
  const normalizedGroups: SettingsGroup[] = groups || (tabs ? [{ id: 'default', label: title, items: tabs }] : [])

  // Find active tab info for header
  const allTabs = normalizedGroups.flatMap(g => g.items)
  const activeTabInfo = allTabs.find(t => t.id === activeTab)

  // Handle Escape key to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <LayoutShell>
      {/* Sidebar Navigation */}
      <NavPanel className="w-[218px] px-2 py-6">
        <div className="space-y-6">
          {normalizedGroups.map((group) => (
            <div key={group.id}>
              {group.label && (
                <div className="px-2 mb-1 text-[11px] font-bold text-sp-muted uppercase tracking-wide truncate">
                  {group.label}
                </div>
              )}
              <nav className="space-y-0.5">
                {group.items.map((tab) => {
                  const isActive = activeTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      onClick={() => onTabChange(tab.id)}
                      className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm font-medium transition-colors
                        ${isActive 
                          ? 'bg-sp-input text-sp-text' 
                          : tab.danger 
                            ? 'text-red-400 hover:bg-red-500/10' 
                            : 'text-sp-muted hover:bg-sp-input/50 hover:text-sp-text'
                        }`}
                    >
                      <Icon name={tab.icon} size={16} className="shrink-0" />
                      {tab.label}
                    </button>
                  )
                })}
              </nav>
            </div>
          ))}
        </div>

        {/* Sidebar Footer (e.g. Delete buttons) */}
        {sidebarFooter && (
          <div className="mt-auto pt-4 border-t border-white/5">
            {sidebarFooter}
          </div>
        )}
      </NavPanel>

      {/* Main Content Area */}
      <ContentPanel>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-2xl mx-auto min-h-full flex flex-col relative">
            <h2 className="text-xl font-bold mb-6">
              {activeTabInfo?.label}
            </h2>
            {children}
            
            {/* Floating Close Button, sticky to top-right - Positioned relative to content container */}
            <div className="absolute top-0 -right-12 xl:-right-20 flex flex-col items-center gap-1">
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-sp-input hover:bg-sp-muted/30 flex items-center justify-center transition-colors group"
              title="Close (Esc)"
            >
              <Icon name="close" size={20} className="text-sp-muted group-hover:text-sp-text" />
            </button>
            <span className="text-[10px] text-sp-muted">ESC</span>
          </div>
        </div>
        </div>
      </ContentPanel>

    </LayoutShell>
  )
}
