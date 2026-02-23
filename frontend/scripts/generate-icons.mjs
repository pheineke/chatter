// scripts/generate-icons.mjs
// Run once: node scripts/generate-icons.mjs
import sharp from 'sharp'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const svgPath = resolve(__dirname, '../public/icon.svg')
const svg = readFileSync(svgPath)

const sizes = [
  { name: 'pwa-192.png', size: 192 },
  { name: 'pwa-512.png', size: 512 },
  { name: 'pwa-180.png', size: 180 }, // apple-touch-icon
  { name: 'pwa-maskable-192.png', size: 192 },
  { name: 'pwa-maskable-512.png', size: 512 },
]

for (const { name, size } of sizes) {
  const out = resolve(__dirname, '../public', name)
  await sharp(svg).resize(size, size).png().toFile(out)
  console.log(`Generated ${name} (${size}x${size})`)
}

console.log('Done.')
