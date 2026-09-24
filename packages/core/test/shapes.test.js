// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  localBounds, pageBounds, hitShape, marqueeHits, scaleShape, textLayout, noteLayout, geoLabelLayout, imageFrame, drawShape,
  runsIn, lineRuns, mapMarks, textLinkAt, urlBadgeAt, markAt, hasMark, setMark, normalizeMarks,
} from '../src/shapes.js'
import { Store } from '../src/store.js'
import { THEMES } from '../src/palette.js'

const geo = (over = {}, props = {}) => ({
  id: 'g1', typeName: 'shape', type: 'geo', x: 10, y: 10, rot: 0, z: 1,
  props: { geo: 'rectangle', w: 100, h: 50, color: 'black', size: 'm', dash: 'solid', fill: 'none', font: 'draw', ...props },
  ...over,
})

describe('bounds', () => {
  it('geo localBounds is its box; pageBounds adds position', () => {
    expect(localBounds(geo())).toEqual({ x: 0, y: 0, w: 100, h: 50 })
    expect(pageBounds(geo())).toEqual({ x: 10, y: 10, w: 100, h: 50 })
  })

  it('rotation grows the axis-aligned page bounds', () => {
    const r = pageBounds(geo({ rot: Math.PI / 4 }))
    expect(r.w).toBeGreaterThan(100)
    expect(r.h).toBeGreaterThan(50)
    // center is preserved
    expect(r.x + r.w / 2).toBeCloseTo(60)
    expect(r.y + r.h / 2).toBeCloseTo(35)
  })

  it('draw bounds cover the points plus stroke margin', () => {
    const d = {
      id: 'd1', typeName: 'shape', type: 'draw', x: 0, y: 0, rot: 0, z: 1,
      props: { pts: [0, 0, 0.5, 50, 20, 0.5], size: 'm', color: 'black', done: true },
    }
    const b = localBounds(d)
    expect(b.x).toBeLessThan(0)
    expect(b.w).toBeGreaterThan(50)
  })

  it('line bounds include negative deltas and arrow bend', () => {
    const line = { id: 'l', typeName: 'shape', type: 'line', x: 0, y: 0, rot: 0, z: 1, props: { dx: -40, dy: 30, size: 'm', color: 'black' } }
    expect(localBounds(line)).toEqual({ x: -40, y: 0, w: 40, h: 30 })
    const arrow = { ...line, type: 'arrow', props: { ...line.props, bend: 10 } }
    expect(localBounds(arrow).w).toBeGreaterThan(40)
    const bentLine = { ...line, props: { ...line.props, bend: 10 } }
    expect(localBounds(bentLine).w).toBeGreaterThan(40)
  })
})

describe('hit testing', () => {
  const store = new Store()

  it('unfilled geo hits only near the edge', () => {
    const s = geo()
    expect(hitShape(s, 10, 10, 4, store)).toBe(true) // corner
    expect(hitShape(s, 60, 35, 4, store)).toBe(false) // center of unfilled rect
  })

  it('filled geo hits anywhere inside', () => {
    const s = geo({}, { fill: 'solid' })
    expect(hitShape(s, 60, 35, 4, store)).toBe(true)
  })

  it('ellipse edge vs inside honors fill', () => {
    const s = geo({}, { geo: 'ellipse' })
    expect(hitShape(s, 60, 35, 4, store)).toBe(false) // hollow center
    expect(hitShape(s, 10 + 50, 10, 4, store)).toBe(true) // top edge midpoint
  })

  it('line hits along its length within tolerance', () => {
    const line = { id: 'l', typeName: 'shape', type: 'line', x: 0, y: 0, rot: 0, z: 1, props: { dx: 100, dy: 0, size: 'm', color: 'black', dash: 'solid' } }
    expect(hitShape(line, 50, 3, 4, store)).toBe(true)
    expect(hitShape(line, 50, 30, 4, store)).toBe(false)
  })

  it('rotated geo hit-tests in rotated space', () => {
    // thin rect rotated 90°: a point above the center (page space) now hits
    const s = geo({ rot: Math.PI / 2 }, { w: 100, h: 10, fill: 'solid' })
    // page center of the shape
    const cx = 10 + 50, cy = 10 + 5
    expect(hitShape(s, cx, cy + 40, 4, store)).toBe(true) // along rotated long axis
    expect(hitShape(s, cx + 40, cy, 4, store)).toBe(false) // along old long axis
  })
})

describe('marquee', () => {
  it('solid-bodied shapes select on bounds overlap; strokes need a graze', () => {
    const note = { id: 'n', typeName: 'shape', type: 'note', x: 0, y: 0, rot: 0, z: 1, props: { text: 'hi', size: 'm', color: 'yellow', font: 'draw' } }
    expect(marqueeHits(note, { x: -5, y: -5, w: 20, h: 20 })).toBe(true)

    const line = { id: 'l', typeName: 'shape', type: 'line', x: 0, y: 0, rot: 0, z: 1, props: { dx: 100, dy: 100, size: 'm', color: 'black' } }
    // rect overlapping the line's bounds but far from the diagonal
    expect(marqueeHits(line, { x: 60, y: 5, w: 30, h: 20 })).toBe(false)
    // rect the diagonal passes through (interior, not just corners)
    expect(marqueeHits(line, { x: 40, y: 30, w: 20, h: 20 })).toBe(true)
  })
})

describe('scaleShape', () => {
  it('scales geo and image boxes', () => {
    expect(scaleShape(geo(), 2, 0.5).props).toMatchObject({ w: 200, h: 25 })
    const img = { id: 'i', typeName: 'shape', type: 'image', x: 0, y: 0, rot: 0, z: 1, props: { w: 40, h: 30, assetId: 'a' } }
    expect(scaleShape(img, 0.5, 0.5).props).toMatchObject({ w: 20, h: 15 })
  })

  it('scales draw points in place', () => {
    const d = { id: 'd', typeName: 'shape', type: 'draw', x: 0, y: 0, rot: 0, z: 1, props: { pts: [10, 10, 0.5], size: 'm' } }
    expect(scaleShape(d, 2, 3).props.pts).toEqual([20, 30, 0.5])
  })

  it('text and note scale via the scale prop, floored', () => {
    const t = { id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1, props: { text: 'x', size: 'm', scale: 1 } }
    expect(scaleShape(t, 2, 2).props.scale).toBeCloseTo(2)
    expect(scaleShape(t, 0.01, 0.01).props.scale).toBe(0.2)
  })

  it('line deltas scale; arrow bend scales geometrically', () => {
    const a = { id: 'a', typeName: 'shape', type: 'arrow', x: 0, y: 0, rot: 0, z: 1, props: { dx: 10, dy: 10, bend: 4 } }
    const s = scaleShape(a, 2, 2)
    expect(s.props.dx).toBe(20)
    expect(s.props.bend).toBeCloseTo(8)
  })
})

describe('text layout', () => {
  it('wraps long text when autosize is off and width fixed', () => {
    const t = { id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1, props: { text: 'aaaa bbbb cccc dddd', size: 'm', autosize: false, w: 120, font: 'draw' } }
    const l = textLayout(t)
    expect(l.lines.length).toBeGreaterThan(1)
    expect(l.w).toBe(120)
  })

  it('caches per props object (identity)', () => {
    const t = { id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1, props: { text: 'hello', size: 'm' } }
    expect(textLayout(t)).toBe(textLayout(t))
  })

  it('empty and multi-line text still lay out', () => {
    const mk = (text) => textLayout({ id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1, props: { text, size: 'm' } })
    expect(mk('').lines.length).toBe(1)
    expect(mk('a\nb\nc').lines.length).toBe(3)
    expect(mk('a\nb\nc').h).toBeGreaterThan(mk('a').h)
  })
})

describe('image crop frame', () => {
  const img = (crop, w = 60, h = 100) => ({
    id: 'i', typeName: 'shape', type: 'image', x: 0, y: 0, rot: 0, z: 1,
    props: { w, h, assetId: 'a', ...(crop ? { crop } : {}) },
  })

  it('an uncropped image is its own frame', () => {
    expect(imageFrame(img(null))).toEqual({ x: 0, y: 0, w: 60, h: 100 })
  })

  it('the frame is the box scaled up by the crop and pushed back by its offset', () => {
    // the box shows the right 60% of the width and the bottom half of the height
    const f = imageFrame(img({ x: 0.4, y: 0.5, w: 0.6, h: 0.5 }))
    expect(f.w).toBeCloseTo(100)
    expect(f.h).toBeCloseTo(200)
    expect(f.x).toBeCloseTo(-40)
    expect(f.y).toBeCloseTo(-100)
  })

  it('drawing a cropped image samples the source window, in crop mode the whole picture too', () => {
    const calls = []
    const ctx = new Proxy({}, { get: (_, k) => (k === 'globalAlpha' ? 1 : (...a) => { calls.push([k, a]); return k === 'measureText' ? { width: 0 } : undefined }) })
    const store = new Store()
    store.put({ id: 'a', typeName: 'asset', src: 'data:,', w: 400, h: 200 })
    // the asset cache holds a not-yet-loaded Image in jsdom: the placeholder draws, nothing throws
    drawShape(ctx, img({ x: 0.25, y: 0, w: 0.5, h: 1 }), { theme: THEMES.light, store, zoom: 1, cropPreview: true })
    expect(calls.some(([k]) => k === 'roundRect')).toBe(true)
  })
})

describe('text marks', () => {
  const text = (t, marks, over = {}) => ({
    id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1,
    props: { text: t, color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1, marks, ...over },
  })

  it('runsIn covers a span with marked and unmarked stretches', () => {
    const marks = [{ from: 2, to: 5, b: true }, { from: 8, to: 10, hl: true }]
    expect(runsIn(marks, 0, 12)).toEqual([[0, 2, {}], [2, 5, marks[0]], [5, 8, {}], [8, 10, marks[1]], [10, 12, {}]])
    expect(runsIn(marks, 3, 4)).toEqual([[3, 4, marks[0]]])
    expect(runsIn([], 0, 3)).toEqual([[0, 3, {}]])
  })

  it('lines remember their offset, so marks slice per line; bold measures wider', () => {
    const plain = textLayout(text('one two three four five six', []))
    const lay = textLayout(text('one two three four five six', [{ from: 4, to: 7, b: true }], { autosize: false, w: 120 }))
    expect(lay.lines.length).toBeGreaterThan(1)
    expect(lay.lines[0].start).toBe(0)
    expect(lay.lines[1].start).toBeGreaterThan(0)
    expect('one two three four five six'.slice(lay.lines[1].start, lay.lines[1].start + lay.lines[1].text.length)).toBe(lay.lines[1].text)
    expect(plain.lines[0].start).toBe(0)
    // the fake measurer sizes by font size only, so runs just have to add up
    const runs = lineRuns(lay.lines[0].text, lay.lines[0], [{ from: 4, to: 7, b: true }], lay.fontSize, lay.font)
    expect(runs.map((r) => r.str).join('')).toBe(lay.lines[0].text)
    expect(runs.find((r) => r.st.b)?.str).toBe('two')
  })

  it('mapMarks carries marks through local edits', () => {
    const marks = [{ from: 0, to: 4, b: true }, { from: 5, to: 9, href: 'https://a' }]
    // typing inside the bold run grows it; the link shifts
    expect(mapMarks(marks, 'bold link!', 'boold link!')).toEqual([{ from: 0, to: 5, b: true }, { from: 6, to: 10, href: 'https://a' }])
    // typing right after the bold run extends it; right before it doesn't
    expect(mapMarks(marks, 'bold link!', 'boldy link!')[0]).toEqual({ from: 0, to: 5, b: true })
    expect(mapMarks(marks, 'bold link!', 'Xbold link!')[0]).toEqual({ from: 1, to: 5, b: true })
    // deleting the whole link drops it
    expect(mapMarks(marks, 'bold link!', 'bold !')).toEqual([{ from: 0, to: 4, b: true }])
    // appending leaves everything
    expect(mapMarks(marks, 'bold link!', 'bold link! more')).toEqual(marks)
    // replacing text before the marks shifts them
    expect(mapMarks(marks, 'bold link!', 'XXbold link!')).toEqual([{ from: 2, to: 6, b: true }, { from: 7, to: 11, href: 'https://a' }])
    expect(mapMarks([], 'a', 'b')).toEqual([])
  })

  it('textLinkAt finds the link under a point, on text, notes and labels', () => {
    const t = text('go to the site now', [{ from: 6, to: 14, href: 'https://site' }])
    const lay = textLayout(t)
    const runs = lineRuns(t.props.text, lay.lines[0], t.props.marks, lay.fontSize, lay.font)
    const link = runs.find((r) => r.st.href)
    expect(textLinkAt(t, link.x + 1, lay.lh / 2)).toBe('https://site')
    expect(textLinkAt(t, 1, lay.lh / 2)).toBe(null)
    expect(textLinkAt(t, link.x + 1, lay.lh * 3)).toBe(null)
    const note = { ...t, id: 'n', type: 'note', props: { text: t.props.text, color: 'yellow', size: 'm', font: 'draw', scale: 2, marks: t.props.marks } }
    const nl = noteLayout(note)
    const nruns = lineRuns(note.props.text, nl.lines[0], note.props.marks, nl.fontSize, nl.font)
    const nlink = nruns.find((r) => r.st.href)
    const top = Math.max(20, nl.boxH / 2 - nl.textH / 2)
    expect(textLinkAt(note, (200 / 2 - nl.lines[0].w / 2 + nlink.x + 1) * 2, (top + nl.lh / 2) * 2)).toBe('https://site')
    const g = geo({}, { label: 'a link here', labelMarks: [{ from: 2, to: 6, href: 'https://g' }] })
    const gl = geoLabelLayout(g)
    const gruns = lineRuns(g.props.label, gl.lines[0], g.props.labelMarks, gl.fontSize, gl.font)
    const glink = gruns.find((r) => r.st.href)
    // the label wraps to two lines in this narrow box; aim at the first
    expect(textLinkAt(g, g.props.w / 2 - gl.lines[0].w / 2 + glink.x + 1, g.props.h / 2 - gl.textH / 2 + gl.lh / 2)).toBe('https://g')
    expect(textLinkAt(geo(), 5, 5)).toBe(null)
    // the badge sits at the top-right of a linked shape
    expect(urlBadgeAt(geo({}, { url: 'https://x' }))).toEqual({ x: 100 - 12, y: 12, r: 9 })
    expect(urlBadgeAt(geo())).toBe(null)
  })
})

describe('spaces in text', () => {
  it("a line's width leaves trailing spaces out, so centred text doesn't shift", () => {
    const t = (text) => textLayout({ id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1, props: { text, color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1 } })
    expect(t('hello   ').lines[0].w).toBeCloseTo(t('hello').lines[0].w)
    // spaces in the middle still count
    expect(t('a   b').lines[0].w).toBeGreaterThan(t('ab').lines[0].w)
  })
})

describe('editing marks', () => {
  it('setMark splits runs at the edges, hasMark asks for the whole range, normalize merges', () => {
    let m = setMark([], 2, 6, 'b', true)
    expect(m).toEqual([{ from: 2, to: 6, b: true }])
    expect(hasMark(m, 2, 6, 'b')).toBe(true)
    expect(hasMark(m, 1, 6, 'b')).toBe(false)
    expect(hasMark(m, 3, 5, 'i')).toBe(false)
    // italic over the tail of the bold run and beyond: three runs
    m = setMark(m, 4, 8, 'i', true)
    expect(m).toEqual([{ from: 2, to: 4, b: true }, { from: 4, to: 6, b: true, i: true }, { from: 6, to: 8, i: true }])
    // clearing bold from the middle leaves the rest bold
    m = setMark(m, 3, 5, 'b', false)
    expect(m).toEqual([{ from: 2, to: 3, b: true }, { from: 4, to: 5, i: true }, { from: 5, to: 6, b: true, i: true }, { from: 6, to: 8, i: true }])
    // making it bold again merges back
    m = setMark(m, 3, 5, 'b', true)
    expect(m).toEqual([{ from: 2, to: 4, b: true }, { from: 4, to: 6, b: true, i: true }, { from: 6, to: 8, i: true }])
    expect(markAt(m, 5)).toEqual({ b: true, i: true })
    expect(markAt(m, 0)).toEqual({})
    // a link carries its href; clearing it drops the run when nothing's left
    m = setMark([], 0, 3, 'href', true, 'https://x')
    expect(m).toEqual([{ from: 0, to: 3, href: 'https://x' }])
    expect(setMark(m, 0, 3, 'href', false)).toEqual([])
    expect(normalizeMarks([{ from: 5, to: 8, b: true }, { from: 0, to: 5, b: true }, { from: 9, to: 9, b: true }])).toEqual([{ from: 0, to: 8, b: true }])
  })
})
