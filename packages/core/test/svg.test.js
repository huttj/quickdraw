// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { Editor } from '../src/editor.js'
import { sceneToSvg } from '../src/svg.js'
import { Store } from '../src/store.js'
import { THEMES } from '../src/palette.js'

const parse = (svg) => {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const err = doc.querySelector('parsererror')
  if (err) throw new Error('bad svg: ' + err.textContent.slice(0, 200))
  return doc
}
const shape = (type, props, over = {}) => ({ id: type + ':' + Math.random().toString(36).slice(2, 6), typeName: 'shape', type, x: 10, y: 20, rot: 0, z: 1, props, ...over })

describe('sceneToSvg', () => {
  it('serializes every shape type into a well-formed document', () => {
    const store = new Store()
    store.put({ id: 'asset:a', typeName: 'asset', src: 'data:image/png;base64,ZmFrZQ==', w: 400, h: 200 })
    const shapes = [
      shape('draw', { pts: [0, 0, 0.5, 40, 10, 0.6, 80, 0, 0.5], color: 'blue', size: 'm', dash: 'draw', done: true }),
      shape('draw', { pts: [0, 0, 0.5, 40, 10, 0.6], color: 'red', size: 's', dash: 'dashed', done: true }),
      shape('highlight', { pts: [0, 0, 0.5, 40, 10, 0.5], color: 'yellow', size: 'm', done: true }),
      shape('geo', { geo: 'rectangle', w: 100, h: 60, color: 'black', size: 'm', dash: 'solid', fill: 'pattern', font: 'draw', label: 'Hi <there> & "you"' }),
      shape('geo', { geo: 'ellipse', w: 100, h: 60, color: 'green', size: 'm', dash: 'draw', fill: 'semi' }, { rot: Math.PI / 4 }),
      shape('geo', { geo: 'cloud', w: 100, h: 60, color: 'green', size: 'm', dash: 'dotted', fill: 'solid' }),
      shape('arrow', { dx: 120, dy: 40, bend: 20, color: 'black', size: 'l', dash: 'solid' }),
      shape('line', { dx: 120, dy: 40, bend: 0, color: 'black', size: 'm', dash: 'dashed' }),
      shape('text', { text: 'one\ntwo', color: 'violet', size: 'm', font: 'mono', autosize: true, scale: 1, align: 'middle' }),
      shape('note', { text: 'sticky', color: 'yellow', size: 'm', font: 'draw', scale: 1.5 }),
      shape('image', { w: 100, h: 50, assetId: 'asset:a', crop: { x: 0.25, y: 0, w: 0.5, h: 1 } }),
      shape('image', { w: 100, h: 50, assetId: 'asset:missing' }),
    ]
    const svg = sceneToSvg(shapes, { theme: THEMES.light, store, grid: 'lines', background: true, margin: 10 })
    const doc = parse(svg)
    const root = doc.documentElement
    expect(root.tagName).toBe('svg')
    expect(root.getAttribute('viewBox')).toMatch(/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/)
    expect(doc.querySelectorAll('g[data-shape]').length).toBe(shapes.length)
    // paper + grid pattern, hatch pattern, note shadow, image clip
    expect(doc.querySelector('pattern#qd-grid')).toBeTruthy()
    expect(doc.querySelector('pattern#qd-hatch-black')).toBeTruthy()
    expect(doc.querySelector('filter#qd-note-shadow')).toBeTruthy()
    expect(doc.querySelectorAll('clipPath').length).toBe(2)
    // the label survives escaping
    const label = [...doc.querySelectorAll('g[data-shape="geo"] text')].find((t) => t.textContent.includes('<there>'))
    expect(label).toBeTruthy()
    // wrapped over several tspans, the words come back verbatim
    expect([...label.querySelectorAll('tspan')].map((t) => t.textContent).join(' ').replace(/\s+/g, ' ')).toBe('Hi <there> & "you"')
    // rotation is a rotate() about the centre before the translate
    const rotated = doc.querySelectorAll('g[data-shape="geo"]')[1]
    expect(rotated.getAttribute('transform')).toMatch(/^rotate\(45 [\d.]+ [\d.]+\) translate\(/)
    // the cropped image draws its full frame (x pulled left by the crop) under the clip
    const img = doc.querySelector('image')
    expect(img.getAttribute('preserveAspectRatio')).toBe('none')
    expect(parseFloat(img.getAttribute('x'))).toBeCloseTo(-50)
    expect(parseFloat(img.getAttribute('width'))).toBeCloseTo(200)
    // dashes and the arrow head
    expect(svg).toContain('stroke-dasharray')
    expect(doc.querySelectorAll('g[data-shape="arrow"] path').length).toBe(2)
    expect(doc.querySelectorAll('g[data-shape="line"] path').length).toBe(1)
    // the note text is centred on the sticky
    const note = doc.querySelector('g[data-shape="note"]')
    expect(note.querySelector('text').getAttribute('text-anchor')).toBe('middle')
    expect(note.querySelector('g').getAttribute('transform')).toBe('scale(1.5)')
  })

  it('leaves the paper off when asked, and skips grids that have no tile', () => {
    const store = new Store()
    const s = [shape('geo', { geo: 'rectangle', w: 10, h: 10, color: 'black', size: 'm', dash: 'solid', fill: 'none' })]
    const bare = parse(sceneToSvg(s, { theme: THEMES.dark, store, grid: 'dots', background: false }))
    expect(bare.querySelectorAll('rect').length).toBe(0)
    const iso = parse(sceneToSvg(s, { theme: THEMES.dark, store, grid: 'iso', background: true }))
    expect(iso.querySelector('pattern')).toBe(null)
    expect(iso.querySelector('rect').getAttribute('fill')).toBe(THEMES.dark.background)
    expect(sceneToSvg([], { theme: THEMES.light, store })).toBe(null)
  })
})

describe('editor.exportSvg', () => {
  it('exports the board or a selection, in drawing order, honouring the grid setting', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor({ container, grid: 'dots' })
    const a = shape('geo', { geo: 'rectangle', w: 10, h: 10, color: 'black', size: 'm', dash: 'solid', fill: 'none' })
    const b = shape('geo', { geo: 'star', w: 10, h: 10, color: 'red', size: 'm', dash: 'solid', fill: 'none' }, { z: 2, x: 300 })
    editor.store.put(a); editor.store.put(b)
    expect(editor.exportSvg({ ids: new Set() })).toBe(null)
    const all = parse(editor.exportSvg())
    expect(all.querySelectorAll('g[data-shape]').length).toBe(2)
    expect(all.querySelector('pattern#qd-grid circle')).toBeTruthy()
    const one = parse(editor.exportSvg({ ids: new Set([b.id]), background: false }))
    expect(one.querySelectorAll('g[data-shape]').length).toBe(1)
    expect(one.querySelector('pattern')).toBe(null)
    editor.destroy()
    container.remove()
  })
})
