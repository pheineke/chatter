/**
 * LayoutShell – centralised two-panel page layout components.
 *
 * Usage:
 *   <LayoutShell>
 *     <NavPanel className="w-[218px] px-2 py-6">…nav items…</NavPanel>
 *     <ContentPanel>…main content…</ContentPanel>
 *   </LayoutShell>
 *
 * The floating-card style (border-radius, border, margin) lives in
 * index.css (.panel-nav / .panel-content) so one CSS edit updates
 * every page that uses these components.
 */

import { type ReactNode } from 'react'

type Props = { children: ReactNode; className?: string }

/** Outer flex container for a full-screen two-panel layout. */
export function LayoutShell({ children, className }: Props) {
  return (
    <div className={`flex h-screen w-full bg-sp-bg text-sp-text overflow-hidden${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}

/**
 * Left navigation panel.
 * Mobile: inline with a right-side divider line.
 * Desktop (md+): floating card via .panel-nav (see index.css).
 *
 * Pass `className` with a `w-*` to set the panel width plus any padding.
 */
export function NavPanel({ children, className }: Props) {
  return (
    <div
      className={`shrink-0 bg-sp-sidebar flex flex-col overflow-y-auto border-r border-sp-divider/20 md:border panel-nav relative z-10${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  )
}

/**
 * Right content area.
 * Wraps children in a padding gutter (md:p-1.5) and then a floating
 * card via .panel-content (see index.css).
 *
 * Children are rendered inside the inner card div.
 * Pass `className` to add extra classes to the inner card (e.g. `flex-col`).
 */
export function ContentPanel({ children, className }: Props) {
  return (
    <div className="flex flex-col flex-1 min-w-0 bg-sp-bg md:p-1.5 relative z-0">
      <div
        className={`flex flex-1 min-w-0 bg-sp-surface panel-content relative isolation-isolate${className ? ` ${className}` : ''}`}
      >
        {children}
      </div>
    </div>
  )
}
