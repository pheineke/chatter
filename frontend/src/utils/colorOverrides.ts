export const COLOR_SWATCHES: { key: string; label: string; default: string; generate: (v: string) => string }[] = [
  {
    key: 'accent', label: 'Accent', default: '#3f51b5',
    generate: v => `
      .bg-sp-mention { background-color: ${v} !important; }
      .bg-sp-primary { background-color: ${v} !important; }
      .bg-sp-primary-container { background-color: ${v} !important; }
      .text-sp-on-primary-container { color: #ffffff !important; }
      .text-sp-on-primary { color: #ffffff !important; }
      .text-sp-mention { color: ${v} !important; }
      .text-sp-primary { color: ${v} !important; }
      .border-sp-mention { border-color: ${v} !important; }
      .border-sp-primary { border-color: ${v} !important; }
      .btn { background-color: ${v} !important; }
      .focus\\:border-sp-mention:focus { border-color: ${v} !important; }
    `,
  },
  {
    key: 'bg', label: 'Background', default: '#1a1a1e',
    generate: v => `
      body { background-color: ${v} !important; } 
      .bg-sp-bg { background-color: ${v} !important; }
      .bg-sp-surface { background-color: ${v} !important; }
    `,
  },
  {
    key: 'sidebar', label: 'Sidebar', default: '#121214',
    generate: v => `
      .bg-sp-sidebar { background-color: ${v} !important; }
      .bg-sp-channels { background-color: ${v} !important; }
      .bg-sp-user    { background-color: ${v} !important; }
    `,
  },
  {
    key: 'servers', label: 'Server Bar', default: '#121214',
    generate: v => `.bg-sp-servers { background-color: ${v} !important; }`,
  },
  {
    key: 'input', label: 'Input / Surface', default: '#383a40',
    generate: v => `
      .bg-sp-input { background-color: ${v} !important; }
      .bg-sp-surface-variant { background-color: ${v} !important; }
      .bg-sp-hover { background-color: ${v} !important; }
      .hover\\:bg-sp-hover:hover { background-color: ${v} !important; }
      .bg-sp-channel-hover { background-color: ${v} !important; }
      .hover\\:bg-sp-channel-hover:hover { background-color: ${v} !important; }
      .bg-sp-popup { background-color: ${v} !important; }
    `,
  },
  {
    key: 'text', label: 'Text', default: '#f2f3f5',
    generate: v => `
      body { color: ${v} !important; }
      .text-sp-text { color: ${v} !important; }
      .text-sp-on-surface { color: ${v} !important; }
    `,
  },
  {
    key: 'muted', label: 'Muted Text', default: '#949ba4',
    generate: v => `.text-sp-muted { color: ${v} !important; }`,
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
