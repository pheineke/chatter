export const COLOR_SWATCHES: { key: string; label: string; default: string; generate: (v: string) => string }[] = [
  {
    key: 'accent', label: 'Accent', default: '#5865f2',
    generate: v => `
      .bg-discord-mention { background-color: ${v} !important; }
      .text-discord-mention { color: ${v} !important; }
      .border-discord-mention { border-color: ${v} !important; }
      .btn { background-color: ${v} !important; }
      .focus\\:border-discord-mention:focus { border-color: ${v} !important; }
    `,
  },
  {
    key: 'bg', label: 'Background', default: '#1a1a1e',
    generate: v => `body { background-color: ${v} !important; } .bg-discord-bg { background-color: ${v} !important; }`,
  },
  {
    key: 'sidebar', label: 'Sidebar', default: '#121214',
    generate: v => `.bg-discord-sidebar { background-color: ${v} !important; }`,
  },
  {
    key: 'servers', label: 'Server Bar', default: '#121214',
    generate: v => `.bg-discord-servers { background-color: ${v} !important; }`,
  },
  {
    key: 'input', label: 'Input / Surface', default: '#383a40',
    generate: v => `.bg-discord-input { background-color: ${v} !important; }`,
  },
  {
    key: 'text', label: 'Text', default: '#f2f3f5',
    generate: v => `body { color: ${v} !important; } .text-discord-text { color: ${v} !important; }`,
  },
  {
    key: 'muted', label: 'Muted Text', default: '#949ba4',
    generate: v => `.text-discord-muted { color: ${v} !important; }`,
  },
]

export function loadColorOverrides(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem('colorOverrides') ?? '{}') } catch { return {} }
}

export function applyColorOverrides(overrides: Record<string, string>) {
  const css = COLOR_SWATCHES
    .filter(s => overrides[s.key])
    .map(s => s.generate(overrides[s.key]))
    .join('\n')
  let tag = document.getElementById('color-overrides') as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = 'color-overrides'
    document.head.appendChild(tag)
  }
  tag.textContent = css
}
