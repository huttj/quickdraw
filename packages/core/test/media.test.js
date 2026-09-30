import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { parseGif, lzwDecode, GifAnimator, isVideoAsset, isGifAsset, guessMime, dataTransferMedia } from '../src/media.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => new Uint8Array(readFileSync(resolve(here, 'fixtures', name)))
const expected = JSON.parse(readFileSync(resolve(here, 'fixtures/anim-frames.json'), 'utf8'))

// pixels equal where visible; a transparent pixel only has to be transparent
function samePicture(got, want) {
  for (let i = 0; i < want.length; i += 4) {
    if (want[i + 3] === 0) { if (got[i + 3] !== 0) return `pixel ${i / 4} should be clear`; continue }
    for (let k = 0; k < 4; k++) if (got[i + k] !== want[i + k]) return `pixel ${i / 4}: ${[...got.slice(i, i + 4)]} ≠ ${want.slice(i, i + 4)}`
  }
  return null
}

// A GIF written by hand, "uncompressed": a clear code before every two
// indices keeps the code width at minCodeSize + 1.
function handGif({ w, h, palette, frames }) {
  const bytes = [...'GIF89a'].map((c) => c.charCodeAt(0))
  const le = (n) => [n & 255, n >> 8]
  const bits = Math.max(1, Math.ceil(Math.log2(palette.length / 3)))
  bytes.push(...le(w), ...le(h), 0x80 | (bits - 1), 0, 0)
  const pal = [...palette]
  while (pal.length < 3 * (1 << bits)) pal.push(0)
  bytes.push(...pal)
  for (const f of frames) {
    bytes.push(0x21, 0xf9, 4, ((f.disposal || 0) << 2) | (f.transparent >= 0 ? 1 : 0), ...le(f.delay / 10), f.transparent >= 0 ? f.transparent : 0, 0)
    bytes.push(0x2c, ...le(f.x), ...le(f.y), ...le(f.w), ...le(f.h), f.interlaced ? 0x40 : 0)
    const min = Math.max(2, bits)
    const size = min + 1
    const clear = 1 << min
    const codes = []
    f.indices.forEach((ix, i) => { if (i % 2 === 0) codes.push(clear); codes.push(ix) })
    codes.push(clear + 1)
    const out = []
    let acc = 0, n = 0
    for (const c of codes) { acc |= c << n; n += size; while (n >= 8) { out.push(acc & 255); acc >>= 8; n -= 8 } }
    if (n) out.push(acc & 255)
    bytes.push(min)
    for (let i = 0; i < out.length; i += 255) { const part = out.slice(i, i + 255); bytes.push(part.length, ...part) }
    bytes.push(0)
  }
  bytes.push(0x3b)
  return new Uint8Array(bytes)
}

describe('GIF decoding', () => {
  for (const name of ['anim.gif', 'anim-interlaced.gif']) {
    it(`plays ${name} frame for frame as Pillow reads it`, () => {
      const gif = parseGif(fixture(name))
      const want = expected[name]
      expect(gif.w).toBe(want.w)
      expect(gif.h).toBe(want.h)
      expect(gif.frames.length).toBe(4)
      const anim = new GifAnimator(gif)
      const delays = []
      for (let i = 0; i < 4; i++) {
        delays.push(anim.step())
        expect(samePicture(anim.pixels, want.frames[i]), `${name} frame ${i}`).toBeNull()
      }
      // 0ms plays at 100ms, the way browsers do
      expect(delays).toEqual([50, 120, 100, 70])
      // and round again from the top
      anim.step()
      expect(samePicture(anim.pixels, want.frames[0])).toBeNull()
    })
  }

  it('reads interlaced rows into place', () => {
    const w = 3, h = 9
    // row r is all index (r % 4): interlaced, rows arrive 0,8, 4, 2,6, 1,3,5,7
    const order = [0, 8, 4, 2, 6, 1, 3, 5, 7]
    const indices = order.flatMap((r) => [r % 4, r % 4, r % 4])
    const palette = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]
    const gif = parseGif(handGif({ w, h, palette, frames: [{ x: 0, y: 0, w, h, delay: 100, transparent: -1, interlaced: true, indices }] }))
    expect(gif.frames[0].interlaced).toBe(true)
    const anim = new GifAnimator(gif)
    anim.step()
    for (let r = 0; r < h; r++) {
      const o = r * w * 4
      expect([...anim.pixels.slice(o, o + 3)]).toEqual(palette.slice((r % 4) * 3, (r % 4) * 3 + 3))
    }
  })

  it('honours disposal: clear to nothing, and restore what was under', () => {
    const palette = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]
    const full = (ix) => Array(4).fill(ix)
    const gif = parseGif(handGif({
      w: 2, h: 2, palette, frames: [
        { x: 0, y: 0, w: 2, h: 2, delay: 100, transparent: -1, indices: full(1) },            // red
        { x: 0, y: 0, w: 1, h: 1, delay: 100, transparent: -1, disposal: 3, indices: [2] },   // green corner, then put back
        { x: 1, y: 1, w: 1, h: 1, delay: 100, transparent: -1, disposal: 2, indices: [3] },   // blue corner, then cleared
        { x: 0, y: 1, w: 1, h: 1, delay: 100, transparent: 0, indices: [0] },                 // clear pixel: nothing drawn
      ],
    }))
    const anim = new GifAnimator(gif)
    const px = (i) => [...anim.pixels.slice(i * 4, i * 4 + 4)]
    anim.step()
    expect(px(0)).toEqual([255, 0, 0, 255])
    anim.step()
    expect(px(0)).toEqual([0, 255, 0, 255])
    anim.step()
    expect(px(0)).toEqual([255, 0, 0, 255]) // disposal 3 restored the red
    expect(px(3)).toEqual([0, 0, 255, 255])
    anim.step()
    expect(px(3)).toEqual([0, 0, 0, 0]) // disposal 2 cleared the blue
    expect(px(2)).toEqual([255, 0, 0, 255]) // the transparent pixel left the red alone
  })

  it('keeps the frames that arrived whole from a truncated file', () => {
    const bytes = fixture('anim.gif')
    const gif = parseGif(bytes.subarray(0, Math.floor(bytes.length * 0.6)))
    expect(gif.frames.length).toBeGreaterThan(0)
    expect(gif.frames.length).toBeLessThan(4)
  })

  it('is not fooled by something else', () => {
    expect(parseGif(new TextEncoder().encode('<html>not a gif</html>'))).toBeNull()
    expect(parseGif(new Uint8Array(4))).toBeNull()
  })

  it('lzwDecode stops at the end of a short stream', () => {
    expect([...lzwDecode(2, new Uint8Array([]), 3)]).toEqual([0, 0, 0])
  })
})

describe('what an asset is', () => {
  it('knows videos and GIFs by type, else by src', () => {
    expect(isVideoAsset({ src: '/api/uploads/abc.webm' })).toBe(true)
    expect(isVideoAsset({ src: 'data:video/mp4;base64,AAAA' })).toBe(true)
    expect(isVideoAsset({ src: 'blob:x', mime: 'video/quicktime' })).toBe(true)
    expect(isVideoAsset({ src: '/api/uploads/abc.png' })).toBe(false)
    expect(isGifAsset({ src: '/api/uploads/abc.gif' })).toBe(true)
    expect(isGifAsset({ src: 'data:image/gif;base64,R0lG' })).toBe(true)
    expect(isGifAsset({ src: '/api/uploads/abc.gif', mime: 'image/png' })).toBe(false)
  })

  it('guesses a type from the name when the file has none', () => {
    expect(guessMime('clip.webm', '')).toBe('video/webm')
    expect(guessMime('https://x.test/a/b.GIF?w=2', 'application/octet-stream')).toBe('image/gif')
    expect(guessMime('photo.png', 'image/png')).toBe('image/png')
    expect(guessMime('notes.txt', '')).toBe('')
  })
})

describe('what a drag carries', () => {
  const dt = (data, files = []) => ({ files, types: Object.keys(data), getData: (t) => data[t] || '' })

  it('takes picture and video files, and leaves the rest', () => {
    const files = [{ name: 'a.png', type: 'image/png' }, { name: 'b.webm', type: '' }, { name: 'c.pdf', type: 'application/pdf' }]
    expect(dataTransferMedia(dt({}, files)).files.map((f) => f.name)).toEqual(['a.png', 'b.webm'])
  })

  it("prefers the picture a page's HTML names over the link around it", () => {
    const got = dataTransferMedia(dt({
      'text/html': '<a href="https://site.test/page"><img alt="x" src="https://cdn.test/cat.gif?a=1&amp;b=2"></a>',
      'text/uri-list': 'https://site.test/page',
    }))
    expect(got.urls).toEqual(['https://cdn.test/cat.gif?a=1&b=2'])
  })

  it('falls back to the uri list, skipping comments', () => {
    expect(dataTransferMedia(dt({ 'text/uri-list': '# from\r\nhttps://cdn.test/v.mp4\r\n' })).urls).toEqual(['https://cdn.test/v.mp4'])
  })
})
