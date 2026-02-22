import { Icon } from './Icon'

interface ShortcutRow {
  keys: string[]
  description: string
}

const SHORTCUTS: { category: string; items: ShortcutRow[] }[] = [
  {
    category: 'Navigation',
    items: [
      { keys: ['Ctrl', 'K'], description: 'Open quick switcher' },
      { keys: ['Alt', '↑'], description: 'Navigate to previous channel' },
      { keys: ['Alt', '↓'], description: 'Navigate to next channel' },
    ],
  },
  {
    category: 'Messaging',
    items: [
      { keys: ['Enter'], description: 'Send message' },
      { keys: ['Shift', 'Enter'], description: 'New line in message' },
      { keys: ['Escape'], description: 'Cancel reply / close dropdown' },
    ],
  },
  {
    category: 'Interface',
    items: [
      { keys: ['Ctrl', '/'], description: 'Show keyboard shortcuts' },
    ],
  },
]

interface Props {
  onClose: () => void
}

export function KeyboardShortcutsDialog({ onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]" onClick={onClose}>
      <div
        className="bg-discord-sidebar w-full max-w-md rounded-xl shadow-2xl border border-white/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/20">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Icon name="command" size={18} className="text-discord-muted" />
            Keyboard Shortcuts
          </h2>
          <button onClick={onClose} className="text-discord-muted hover:text-discord-text transition-colors">
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Shortcuts list */}
        <div className="px-6 py-4 space-y-5 max-h-[60vh] overflow-y-auto">
          {SHORTCUTS.map((group) => (
            <div key={group.category}>
              <div className="text-xs font-bold uppercase text-discord-muted tracking-wider mb-2">
                {group.category}
              </div>
              <div className="space-y-1.5">
                {group.items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span className="text-sm text-discord-muted">{item.description}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((key, ki) => (
                        <span key={ki} className="flex items-center gap-1">
                          <kbd className="bg-discord-input text-discord-text text-xs px-2 py-0.5 rounded border border-white/10">
                            {key}
                          </kbd>
                          {ki < item.keys.length - 1 && (
                            <span className="text-discord-muted text-xs">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
