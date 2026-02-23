import { useEffect, useRef } from 'react'
import { renderMarkdown } from '../utils/markdown'

interface Props {
  text: string
  className?: string
}

/**
 * Renders Discord-flavoured markdown inside a div.
 *
 * Spoiler reveal is handled via click-delegation on the outer div so that
 * DOMPurify's stripping of `onclick` attributes doesn't interfere.
 */
export function MarkdownContent({ text, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Attach spoiler click handler via event delegation.
  useEffect(() => {
    const el = ref.current
    if (!el) return

    function handleClick(e: MouseEvent) {
      const spoiler = (e.target as HTMLElement).closest<HTMLElement>('[data-spoiler]')
      if (spoiler) spoiler.classList.toggle('revealed')
    }

    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [text])

  return (
    <div
      ref={ref}
      className={`discord-markdown ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  )
}
