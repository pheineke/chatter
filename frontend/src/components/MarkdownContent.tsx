import { useEffect, useRef } from 'react'
import { renderMarkdown } from '../utils/markdown'

/** Inline SVG data URIs for the copy button icons (mask-image). */
const FILE_ICON = "url('/icons/file-outline.svg')"
const CHECK_ICON = "url('/icons/checkmark-outline.svg')"

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

  // Attach spoiler click handler + inject copy buttons into <pre> blocks.
  useEffect(() => {
    const el = ref.current
    if (!el) return

    // ── Inject copy button into every <pre> ────────────────────────────
    el.querySelectorAll<HTMLPreElement>('pre').forEach((pre) => {
      // Skip if already has a button
      if (pre.querySelector('.code-copy-btn')) return

      pre.style.position = 'relative'

      const btn = document.createElement('button')
      btn.className = 'code-copy-btn'
      btn.title = 'Copy'
      btn.type = 'button'

      // Icon span (uses mask-image like the Icon component)
      const icon = document.createElement('span')
      icon.className = 'code-copy-icon'
      icon.style.maskImage = FILE_ICON
      icon.style.webkitMaskImage = FILE_ICON
      btn.appendChild(icon)

      pre.appendChild(btn)
    })

    // ── Event delegation for spoilers and copy buttons ──────────────────
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement

      // Spoiler toggle
      const spoiler = target.closest<HTMLElement>('[data-spoiler]')
      if (spoiler) {
        spoiler.classList.toggle('revealed')
        return
      }

      // Code-block copy
      const btn = target.closest<HTMLButtonElement>('.code-copy-btn')
      if (btn) {
        const pre = btn.closest('pre')
        if (!pre) return

        // Get only the <code> text (excludes the button itself)
        const code = pre.querySelector('code')
        const raw = (code ?? pre).textContent ?? ''

        navigator.clipboard.writeText(raw).then(() => {
          const icon = btn.querySelector<HTMLSpanElement>('.code-copy-icon')
          if (icon) {
            icon.style.maskImage = CHECK_ICON
            icon.style.webkitMaskImage = CHECK_ICON
            btn.classList.add('copied')
          }
          setTimeout(() => {
            if (icon) {
              icon.style.maskImage = FILE_ICON
              icon.style.webkitMaskImage = FILE_ICON
              btn.classList.remove('copied')
            }
          }, 2000)
        })
      }
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
