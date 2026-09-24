// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { parseTldrawClipboard, convertTldrawContent, richTextToPlain, richTextToText, decodeDrawPath } from '../src/tldraw.js'
import { Editor } from '../src/editor.js'
import { pageBounds } from '../src/shapes.js'

// generated from tldraw's own clipboard format with the real lz-string and
// tldraw's path encoder (see the changelog): v3, v2, and the older
// fully-compressed payload, plus one with pre-v3 inline arrow bindings and
// point-array strokes
const fx = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/tldraw-clipboard.json'), 'utf8'))
const byId = (shapes, id) => shapes.find((s) => s.id === 'shape:' + id)

describe('tldraw clipboard', () => {
  it('reads the v3, v2 and legacy payloads to the same content', () => {
    const v3 = parseTldrawClipboard(fx.v3html)
    const v2 = parseTldrawClipboard(fx.v2html)
    const legacy = parseTldrawClipboard(fx.legacyHtml)
    for (const c of [v3, v2, legacy]) {
      expect(c.shapes.length).toBe(16)
      expect(c.bindings.length).toBe(2)
      expect(c.assets.length).toBe(1)
    }
    expect(v3.shapes).toEqual(v2.shapes)
    expect(parseTldrawClipboard('<p>just html</p>')).toBe(null)
    expect(parseTldrawClipboard('<div data-tldraw>not json at all</div>')).toBe(null)
    expect(parseTldrawClipboard('')).toBe(null)
    // an entity-escaped copy of the HTML still reads
    expect(parseTldrawClipboard(fx.v2html.replace(/"/g, '&quot;')).shapes.length).toBe(16)
  })

  it('rich text flattens to lines, marks keep their offsets', () => {
    expect(richTextToPlain('plain')).toBe('plain')
    const { text, marks } = richTextToText({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'see ' }, { type: 'text', text: 'this', marks: [{ type: 'link', attrs: { href: 'https://t' } }, { type: 'underline' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'code', marks: [{ type: 'code' }] }, { type: 'text', text: ' and ' }, { type: 'text', text: 'gone', marks: [{ type: 'strike' }] }] },
    ] })
    expect(text).toBe('see this\ncode and gone')
    expect(marks).toEqual([{ from: 4, to: 8, href: 'https://t', u: true }, { from: 9, to: 13, code: true }, { from: 18, to: 22, s: true }])
    expect(richTextToPlain({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] },
      { type: 'paragraph' },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }] },
    ] })).toBe('a\nb\n\n• item')
    expect(decodeDrawPath('')).toEqual([])
  })

  it('converts every shape type onto ours', () => {
    const { shapes, assets } = convertTldrawContent(parseTldrawClipboard(fx.v3html))
    // groups have no body; everything else has a twin
    expect(shapes.length).toBe(15)
    expect(shapes.map((s) => s.z)).toEqual([...shapes.map((s) => s.z)].sort((a, b) => a - b))

    const text = byId(shapes, 'text1')
    expect(text.type).toBe('text')
    expect(text.props).toMatchObject({ text: 'Hello\nworld', color: 'blue', size: 'm', font: 'draw', align: 'middle', autosize: false, w: 200 })
    // rich text marks come across: bold link on "Hel", highlighted italic "world"
    expect(text.props.marks).toEqual([
      { from: 0, to: 3, b: true, href: 'https://example.com/x' },
      { from: 6, to: 11, hl: true, i: true },
    ])
    expect(byId(shapes, 'note1').props).toMatchObject({ text: 'sticky', color: 'yellow', font: 'sans' })
    expect(byId(shapes, 'note1').props.marks).toBeUndefined()

    const box = byId(shapes, 'geo1')
    expect(box.props).toMatchObject({ geo: 'rectangle', w: 160, h: 90, fill: 'solid', dash: 'draw', color: 'green', size: 'l', label: 'box', labelSize: 'l', url: 'https://example.com/box' })
    expect([box.x, box.y]).toEqual([100, 400])
    // a pentagon is close enough to a hexagon; the rotated one keeps its
    // place: tldraw turned it about its origin (500,400), so its centre is
    // where (550,450) lands after a quarter turn about (500,400) = (450,450)
    const pent = byId(shapes, 'geo2')
    expect(pent.props.geo).toBe('hexagon')
    expect(pent.rot).toBeCloseTo(Math.PI / 2)
    expect(pent.x + pent.props.w / 2).toBeCloseTo(450)
    expect(pent.y + pent.props.h / 2).toBeCloseTo(450)

    const ink = byId(shapes, 'draw1')
    expect(ink.type).toBe('draw')
    expect(ink.props.done).toBe(true)
    expect(ink.props.pts.length).toBe(12)
    expect(ink.props.pts[3]).toBeCloseTo(40, 1) // scaleX 2 applied to x=20
    expect(ink.props.pts[4]).toBeCloseTo(10, 1)
    expect(ink.props.pts[5]).toBeCloseTo(0.6, 2)
    const hl = byId(shapes, 'hl1')
    expect(hl.type).toBe('highlight')
    expect(hl.props.pts.length).toBe(9)
    expect(hl.props.pts[2]).toBe(0.5) // dim 2: default pressure

    // arrow with v3 bindings: start at the box's centre, end at a precise anchor
    const ar = byId(shapes, 'arrow1')
    expect(ar.type).toBe('arrow')
    expect(ar.props.startBind).toEqual({ id: 'shape:geo1', nx: 0.5, ny: 0.5 })
    expect(ar.props.endBind).toEqual({ id: 'shape:geo2', nx: 0.2, ny: 0.8 })
    expect(ar.props.bend).toBe(30)
    expect([ar.x, ar.y]).toEqual([180, 445])
    // a head only at the start: turned round so the head is at our end
    const ar2 = byId(shapes, 'arrow2')
    expect(ar2.type).toBe('arrow')
    expect([ar2.x, ar2.y]).toEqual([500, 600])
    expect(ar2.props.dx).toBe(-200)
    expect(ar2.props.dash).toBe('dashed')

    // lines: two points stay a line, more become an even stroke
    const l1 = byId(shapes, 'line1')
    expect(l1.type).toBe('line')
    expect(l1.props).toMatchObject({ dx: 150, dy: 40, dash: 'solid' })
    const l2 = byId(shapes, 'line2')
    expect(l2.type).toBe('draw')
    expect(l2.props.dash).toBe('dotted')
    expect(l2.props.pts.length).toBe(9)
    expect(l2.props.pts.slice(3, 5)).toEqual([50, 40]) // sorted by index, not object order

    // image with crop → our normalized window; its asset comes along
    const img = byId(shapes, 'img1')
    expect(img.props).toMatchObject({ w: 120, h: 60, assetId: 'asset:img', crop: { x: 0.25, y: 0, w: 0.5, h: 1 } })
    expect(assets).toEqual([{ id: 'asset:img', typeName: 'asset', src: expect.stringMatching(/^data:image\/png/), w: 2, h: 2 }])

    // a frame becomes a labelled rectangle; its child lands in page space
    const frame = byId(shapes, 'frame1')
    expect(frame.type).toBe('geo')
    expect(frame.props.label).toBe('My frame')
    const inner = byId(shapes, 'inframe')
    expect([inner.x, inner.y]).toEqual([1020, 120])
    expect(inner.props.fill).toBe('semi')

    // group members share a group id and follow the group's rotation
    const ga = byId(shapes, 'g_a'), gb = byId(shapes, 'g_b')
    expect(ga.groupId).toBe('group:shape:group1')
    expect(gb.groupId).toBe(ga.groupId)
    expect(byId(shapes, 'group1')).toBeUndefined()
    expect(ga.rot).toBeCloseTo(Math.PI / 4)
    // g_b sits 100 along the group's rotated x axis from g_a's origin
    const ca = { x: ga.x + 30, y: ga.y + 30 }, cb = { x: gb.x + 30, y: gb.y + 30 }
    expect(Math.hypot(cb.x - ca.x, cb.y - ca.y)).toBeCloseTo(100)
    expect(Math.atan2(cb.y - ca.y, cb.x - ca.x)).toBeCloseTo(Math.PI / 4)
  })

  it('reads pre-v3 data: inline arrow bindings and point-array strokes', () => {
    const { shapes } = convertTldrawContent(parseTldrawClipboard(fx.legacyPointsHtml))
    const ar = byId(shapes, 'arrowL')
    expect(ar.props.startBind).toEqual({ id: 'shape:geo1', nx: 0.5, ny: 0.5 })
    expect(ar.props.endBind).toBeUndefined()
    expect(ar.x + ar.props.dx).toBeCloseTo(50)
    expect(byId(shapes, 'draw1').props.pts).toEqual([0, 0, 0.5, 60, 30, 0.5]) // scaleX 2
  })
})

describe('pasting into the editor', () => {
  const paste = (ed, html, text = '') =>
    ed._paste({ clipboardData: { files: [], getData: (t) => (t === 'text/html' ? html : t === 'text/plain' ? text : '') }, preventDefault() {} })
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('⌘V of a tldraw copy lands its shapes, centred in the view, tied up and selected', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true })
    const editor = new Editor({ container })
    editor.setCamera({ x: -1000, y: -2000, z: 1 }) // the view is far from tldraw's coordinates
    const n0 = editor.store.undos.length
    paste(editor, fx.v3html, 'Hello world sticky box')
    await flush(); await flush()
    const shapes = editor.store.shapes()
    expect(shapes.length).toBe(15)
    expect(editor.selection.size).toBe(15)
    expect(editor.store.undos.length).toBe(n0 + 1) // one step
    // fresh ids, bindings and groups remapped onto them
    expect(shapes.every((s) => !s.id.startsWith('shape:geo'))).toBe(true)
    const ar = shapes.find((s) => s.type === 'arrow' && s.props.startBind)
    const target = editor.store.get(ar.props.startBind.id)
    expect(target?.props.label).toBe('box')
    // the bound start sits on the box's outline, not at tldraw's stored point
    const tb = pageBounds(target)
    expect(ar.x).toBeGreaterThan(tb.x + tb.w - 1)
    const grouped = shapes.filter((s) => s.groupId)
    expect(grouped.length).toBe(2)
    expect(grouped[0].groupId).toBe(grouped[1].groupId)
    expect(grouped[0].groupId.startsWith('group:')).toBe(true)
    // the image found its asset under its new id
    const img = shapes.find((s) => s.type === 'image')
    expect(editor.store.asset(img.props.assetId)).toBeTruthy()
    // the whole bundle is centred on the viewport
    let b = null
    for (const s of shapes) { const pb = pageBounds(s); b = b ? { x: Math.min(b.x, pb.x), y: Math.min(b.y, pb.y), r: Math.max(b.r, pb.x + pb.w), b: Math.max(b.b, pb.y + pb.h) } : { x: pb.x, y: pb.y, r: pb.x + pb.w, b: pb.y + pb.h } }
    const vp = editor.viewportPageBounds()
    expect((b.x + b.r) / 2).toBeCloseTo(vp.x + vp.w / 2, 0)
    expect((b.y + b.b) / 2).toBeCloseTo(vp.y + vp.h / 2, 0)
    editor.destroy()
    container.remove()
  })

  it('plain text pastes as a text shape; ordinary HTML falls through to its text', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor({ container })
    paste(editor, '', 'just some words')
    await flush(); await flush()
    let [t] = editor.store.shapes()
    expect(t.type).toBe('text')
    expect(t.props.text).toBe('just some words')
    expect([...editor.selection]).toEqual([t.id])
    paste(editor, '<b>bold</b> words', 'bold words')
    await flush(); await flush()
    expect(editor.store.shapes().length).toBe(2)
    // our own payload still round-trips through the text path
    paste(editor, '', JSON.stringify({ quickdraw: 1, shapes: [t], assets: {} }))
    await flush(); await flush()
    expect(editor.store.shapes().length).toBe(3)
    // nothing on the clipboard, nothing happens; readonly boards ignore it
    paste(editor, '', '   ')
    editor.setReadonly(true)
    paste(editor, fx.v3html)
    await flush(); await flush()
    expect(editor.store.shapes().length).toBe(3)
    editor.destroy()
    container.remove()
  })
})
