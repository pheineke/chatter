import type { HTMLAttributes } from 'react'

interface Props extends HTMLAttributes<HTMLSpanElement> {
  /** Icon name without the `-outline.svg` suffix, e.g. "lock", "mic-off" */
  name: string
  size?: number
}

/**
 * Renders an SVG from /public/icons as a CSS-masked element so it
 * inherits the parent's text color via `bg-current`.
 * No SVG code is copied — the file is referenced by URL.
 */
export function Icon({ name, size = 20, style, className = '', ...rest }: Props) {
  const url = `/icons/${name}-outline.svg`
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url('${url}')`,
        maskImage: `url('${url}')`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        ...style,
      }}
      {...rest}
    />
  )
}
