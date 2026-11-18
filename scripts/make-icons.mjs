// =============================================================================
// WHAT THIS FILE IS
//   Generates the app icons (PNG) used by the PWA manifest, iPhone home screen
//   and notifications: the brand mark, a gold cloche (banquet serving dome)
//   on its tray with a small sparkle, on the app's navy.
//   Same geometry as src/components/BrandMark.tsx and public/favicon.svg.
// WHY IT EXISTS
//   Installable apps need real PNG icons in fixed sizes. This draws them with
//   plain Node (no image libraries), so `npm run icons` recreates them
//   anywhere. Shapes are drawn with soft (anti-aliased) edges, and the mark is
//   kept inside the central "safe zone", so Android can crop the icon to a
//   circle or squircle (maskable).
// OUTPUT
//   public/icon-192.png, public/icon-512.png, public/icon-maskable-512.png,
//   public/apple-touch-icon.png (180)
// USAGE
//   npm run icons
// =============================================================================
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const INK = [29, 40, 64]          // tile navy (#1d2840)
const GOLD = [224, 162, 37]       // --color-marigold (strokes)
const LAMP = [246, 220, 148]      // pale gold lamp (#f6dc94)

// ---- tiny PNG encoder ----------------------------------------------------------
const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0   // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---- shapes as signed distance fields (in units of the icon, 0..1) -------------
const sdRoundBox = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
const sdSegment = (px, py, ax, ay, bx, by) => {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)))
  return Math.hypot(pax - bax * h, pay - bay * h)
}

// ---- the mark, on the 32-unit grid of BrandMark.tsx (converted to 0..1) -----------
const U = (v) => v / 32
const STROKE = U(1.2)                       // half of the 2.4 stroke width
const DOME_C = [U(15), U(21)], DOME_R = U(9)
const MID = U(15)                           // used by the glow below

/** Distance to the upper half of the dome circle (a stroke). */
function domeDistance(x, y) {
  const [cx, cy] = DOME_C
  if (y <= cy) return Math.abs(Math.hypot(x - cx, y - cy) - DOME_R)
  return Math.min(Math.hypot(x - (cx - DOME_R), y - cy), Math.hypot(x - (cx + DOME_R), y - cy))
}

/** Signed distance to a polygon (negative inside). */
function sdPolygon(x, y, pts) {
  let d = Infinity, sign = 1
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i]
    d = Math.min(d, sdSegment(x, y, ax, ay, bx, by))
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) sign = -sign
  }
  return sign * d
}
const SPARKLE = [[25.5, 4.6], [26.5, 7], [28.9, 8], [26.5, 9], [25.5, 11.4], [24.5, 9], [22.1, 8], [24.5, 7]].map(([px, py]) => [U(px), U(py)])

/** Distance to the gold strokes (dome + tray); negative = inside. */
function strokeDistance(x, y) {
  const tray = sdSegment(x, y, U(4), U(24.5), U(26), U(24.5))
  return Math.min(domeDistance(x, y), tray) - STROKE
}
/** Distance to the pale-gold solids (knob + sparkle). */
const lampDistance = (x, y) => Math.min(Math.hypot(x - U(15), y - U(10.2)) - U(2), sdPolygon(x, y, SPARKLE))

function render(size, { maskable }) {
  const buf = Buffer.alloc(size * size * 4)
  const scale = maskable ? 0.8 : 1           // keep the mark inside the maskable safe zone
  const corner = maskable ? 0 : 0.25         // rounded square (rx 8 of 32) for normal icons, full bleed for maskable
  const aa = 1.2 / size
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size, y = (py + 0.5) / size
      const bg = maskable ? -1 : sdRoundBox(x, y, 0.5, 0.5, 0.5, 0.5, corner)
      const bgA = Math.max(0, Math.min(1, 0.5 - bg / aa))
      // scale the glyph around the centre
      const gx = 0.5 + (x - 0.5) / scale, gy = 0.5 + (y - 0.5) / scale
      const gA = Math.max(0, Math.min(1, 0.5 - (strokeDistance(gx, gy) * scale) / aa))
      const lA = Math.max(0, Math.min(1, 0.5 - (lampDistance(gx, gy) * scale) / aa))
      // soft warm glow inside the dome
      const glow = Math.max(0, 1 - Math.hypot(gx - MID, gy - U(17.5)) / U(7)) ** 2 * 0.22
      const i = (py * size + px) * 4
      for (let ch = 0; ch < 3; ch++) {
        let c = INK[ch] * (1 - glow) + LAMP[ch] * glow
        c = c * (1 - gA) + GOLD[ch] * gA
        c = c * (1 - lA) + LAMP[ch] * lA
        buf[i + ch] = Math.round(c)
      }
      buf[i + 3] = Math.round(255 * bgA)
    }
  }
  return png(size, buf)
}

const out = (name, size, opts) => { writeFileSync(new URL(`../public/${name}`, import.meta.url), render(size, opts)); console.log('wrote public/' + name) }
out('icon-192.png', 192, { maskable: false })
out('icon-512.png', 512, { maskable: false })
out('icon-maskable-512.png', 512, { maskable: true })
out('apple-touch-icon.png', 180, { maskable: true })   // iOS rounds the corners itself
