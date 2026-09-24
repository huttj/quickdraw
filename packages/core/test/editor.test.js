// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Editor, TOOLS } from '../src/editor.js'
import { createQuickdraw } from '../src/index.js'
import { pageBounds, textLayout, lineRuns, localBounds } from '../src/shapes.js'

// Fake pointer events fed straight to the editor's handlers. The container
// sits at (0,0) in jsdom, so clientX/Y are screen coords directly.
let pid = 1
const ev = (x, y, over = {}) => ({
  pointerId: over.pointerId ?? pid,
  pointerType: 'mouse',
  clientX: x,
  clientY: y,
  button: 0,
  pressure: 0.5,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  target: null, // patched to editor.canvas below
  preventDefault() {},
  stopPropagation() {},
  ...over,
})

function drag(editor, pts, over = {}) {
  pid++
  const [x0, y0] = pts[0]
  editor._pointerDown({ ...ev(x0, y0, over), target: editor.canvas })
  for (const [x, y] of pts.slice(1)) editor._pointerMove({ ...ev(x, y, over), target: editor.canvas })
  const [xn, yn] = pts[pts.length - 1]
  editor._pointerUp({ ...ev(xn, yn, over), target: editor.canvas })
}

let container, editor

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  editor = new Editor({ container })
})

afterEach(() => {
  editor.destroy()
  container.remove()
})

describe('setup', () => {
  it('mounts canvases and starts on the pointer', () => {
    expect(container.querySelectorAll('canvas').length).toBe(2)
    expect(editor.tool).toBe('select')
    expect(TOOLS).toContain('draw')
  })

  it('camera math round-trips', () => {
    editor.setCamera({ x: 50, y: -20, z: 2 })
    const p = editor.screenToPage(100, 100)
    const s = editor.pageToScreen(p.x, p.y)
    expect(s.x).toBeCloseTo(100)
    expect(s.y).toBeCloseTo(100)
  })

  it('zoomAt keeps the anchor point fixed', () => {
    const before = editor.screenToPage(80, 60)
    editor.zoomAt(80, 60, 2)
    const after = editor.screenToPage(80, 60)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(editor.camera.z).toBeCloseTo(2)
  })
})

describe('deferred fit', () => {
  it('fitContent before layout waits for real dimensions instead of clamping to min zoom', () => {
    editor.setTool('geo')
    drag(editor, [[10, 10], [110, 60]])
    // jsdom containers measure 0x0 — exactly the "no layout yet" case
    editor.fitContent()
    expect(editor.camera.z).toBe(1) // untouched, not clamped to 0.05

    // layout arrives: the container now measures 800x600 and render() replays the fit
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true })
    editor.render()
    expect(editor.camera.z).toBeGreaterThan(0.5)
    // the shape's center lands mid-view
    const c = editor.pageToScreen(60, 35)
    expect(c.x).toBeCloseTo(400, 0)
    expect(c.y).toBeCloseTo(300, 0)
  })
})

describe('drawing', () => {
  it('a drag with the draw tool creates one stroke, undoable as one step', () => {
    editor.setTool('draw')
    drag(editor, [[10, 10], [20, 15], [40, 30], [60, 50]])
    const shapes = editor.store.shapes()
    expect(shapes.length).toBe(1)
    expect(shapes[0].type).toBe('draw')
    expect(shapes[0].props.done).toBe(true)
    expect(shapes[0].props.pts.length).toBeGreaterThanOrEqual(6)
    expect(editor.store.undos.length).toBe(1)
    editor.store.undo()
    expect(editor.store.shapes().length).toBe(0)
  })

  it('highlights keep their place in the z order (the multiply blend does the marker look)', () => {
    editor.setTool('draw')
    drag(editor, [[10, 10], [60, 60]])
    editor.setTool('highlight')
    drag(editor, [[10, 20], [60, 70]])
    const sorted = editor.shapesSorted()
    expect(sorted[0].type).toBe('draw')
    expect(sorted[1].type).toBe('highlight') // drawn later, so on top — of a picture too
  })
})

describe('geo / line / arrow', () => {
  it('dragging geo creates a rect of the dragged size and selects it', () => {
    editor.setTool('geo')
    drag(editor, [[10, 10], [110, 60]])
    const [s] = editor.store.shapes()
    expect(s.type).toBe('geo')
    expect(s.props.w).toBeCloseTo(100)
    expect(s.props.h).toBeCloseTo(50)
    expect(editor.tool).toBe('select') // tool returns to select
    expect(editor.selection.has(s.id)).toBe(true)
  })

  it('a click (no drag) drops a ready-made 160x160 shape', () => {
    editor.setTool('geo')
    drag(editor, [[50, 50]])
    const [s] = editor.store.shapes()
    expect(s.props.w).toBe(160)
    expect(s.props.h).toBe(160)
  })

  it('arrow drag sets dx/dy; tiny arrows evaporate', () => {
    editor.setTool('arrow')
    drag(editor, [[10, 10], [110, 40]])
    const [s] = editor.store.shapes()
    expect(s.type).toBe('arrow')
    expect(s.props.dx).toBeCloseTo(100)
    expect(s.props.dy).toBeCloseTo(30)

    editor.setTool('arrow')
    drag(editor, [[200, 200], [200.5, 200.5]])
    expect(editor.store.shapes().length).toBe(1) // the tiny one is gone
  })

  it('shift snaps lines to 15-degree steps', () => {
    editor.setTool('line')
    pid++
    editor._pointerDown({ ...ev(0, 0), target: editor.canvas })
    editor._pointerMove({ ...ev(100, 8, { shiftKey: true }), target: editor.canvas })
    const [s] = editor.store.shapes()
    expect(s.props.dy).toBeCloseTo(0) // snapped flat
    editor._pointerUp({ ...ev(100, 8, { shiftKey: true }), target: editor.canvas })
  })
})

describe('selection & transforms', () => {
  const makeRect = (x, y, w = 60, h = 40) => {
    editor.setTool('geo')
    drag(editor, [[x, y], [x + w, y + h]])
    return editor.store.shapes()[editor.store.shapes().length - 1]
  }

  it('click selects, click empty clears, shift-click toggles', () => {
    const a = makeRect(10, 10)
    const b = makeRect(200, 10)
    // plain click on a's edge
    drag(editor, [[10, 10]])
    expect([...editor.selection]).toEqual([a.id])
    // shift-click b adds
    drag(editor, [[200, 10]], { shiftKey: true })
    expect(editor.selection.size).toBe(2)
    // click empty space clears
    drag(editor, [[400, 400]])
    expect(editor.selection.size).toBe(0)
    expect(b.id).toBeTruthy()
  })

  it('marquee selects grazed shapes', () => {
    const a = makeRect(20, 20)
    makeRect(300, 300)
    drag(editor, [[0, 0], [120, 120]])
    expect([...editor.selection]).toEqual([a.id])
  })

  it('dragging a selected shape translates it (one undo step)', () => {
    const a = makeRect(10, 10)
    editor.setSelection([a.id])
    const undosBefore = editor.store.undos.length
    // press on the top edge but away from resize handles, drag +40/+50
    drag(editor, [[30, 14], [70, 64]])
    const moved = editor.store.get(a.id)
    expect(moved.x).toBeCloseTo(a.x + 40)
    expect(moved.y).toBeCloseTo(a.y + 50)
    expect(editor.store.undos.length).toBe(undosBefore + 1)
  })

  it('deleteSelection / selectAll / duplicateSelection', () => {
    makeRect(10, 10)
    makeRect(100, 10)
    editor.selectAll()
    expect(editor.selection.size).toBe(2)
    editor.duplicateSelection()
    expect(editor.store.shapes().length).toBe(4)
    expect(editor.selection.size).toBe(2) // the copies
    editor.selectAll()
    editor.deleteSelection()
    expect(editor.store.shapes().length).toBe(0)
  })

  it('bringToFront / sendToBack reorder z', () => {
    const a = makeRect(10, 10)
    const b = makeRect(20, 20)
    expect(b.z).toBeGreaterThan(a.z)
    editor.setSelection([a.id])
    editor.bringToFront()
    expect(editor.store.get(a.id).z).toBeGreaterThan(editor.store.get(b.id).z)
    editor.sendToBack()
    expect(editor.store.get(a.id).z).toBeLessThan(editor.store.get(b.id).z)
  })

  it('the rotate knob (for fingers) turns with a rotated shape instead of hovering over its bounding box', () => {
    const a = makeRect(100, 100, 100, 60) // centre 150,130
    editor.setSelection([a.id])
    editor._coarse = true // a touch board keeps the knob
    // unrotated: 22px above the middle of the top edge
    expect(editor._hitHandle(150, 78)?.kind).toBe('rotate')
    editor.store.update(a.id, { rot: Math.PI / 2 }) // a quarter turn clockwise
    // the top edge's middle now sits at the right of the centre (180,130) and
    // "up" points to the right: the knob is at (202,130)
    expect(editor._hitHandle(202, 130)?.kind).toBe('rotate')
    // and nowhere near the old spot above the axis-aligned box (the rotated
    // frame's own left handle now sits at (150,80), but it isn't the knob)
    expect(editor._hitHandle(150, 58)).toBe(null)
    expect(editor._hitHandle(150, 78)?.kind).not.toBe('rotate')
    // dragging it rotates about the centre
    const before = editor.store.get(a.id).rot
    drag(editor, [[202, 130], [150, 182]])
    expect(editor.store.get(a.id).rot).toBeCloseTo(before + Math.PI / 2)
  })

  it('eraser removes everything it swept over in one undo step', () => {
    makeRect(10, 10)
    makeRect(100, 100)
    editor.setTool('eraser')
    drag(editor, [[10, 10], [100, 100]]) // sweep corner to corner
    expect(editor.store.shapes().length).toBe(0)
    editor.store.undo()
    expect(editor.store.shapes().length).toBe(2)
  })
})

describe('text & notes', () => {
  it('placing text opens the text surface; typing commits; empty evaporates', () => {
    editor.setTool('text')
    drag(editor, [[50, 50]])
    expect(container.querySelector('.qd-text-edit')).toBeTruthy()
    const ta = editor.editing.textarea // the surface: a textarea's API over a contenteditable
    ta.value = 'hello world'
    ta.dispatchEvent(new window.Event('input'))
    editor._commitText()
    const [s] = editor.store.shapes()
    expect(s.type).toBe('text')
    expect(s.props.text).toBe('hello world')

    // empty text evaporates on commit
    editor.setTool('text')
    drag(editor, [[200, 200]])
    editor._commitText()
    expect(editor.store.shapes().length).toBe(1)
  })

  it('notes get the note default color when the pen is on the default ink', () => {
    editor.setTool('note')
    drag(editor, [[50, 50]])
    const note = editor.store.shapes().find((s) => s.type === 'note')
    expect(note.props.color).toBe('yellow')
    const ta = editor.editing.textarea
    ta.value = 'sticky'
    ta.dispatchEvent(new window.Event('input'))
    editor._commitText()
    expect(editor.store.get(note.id).props.text).toBe('sticky')
  })
})

describe('styles', () => {
  it('setStyle updates the pen and any applicable selection', () => {
    editor.setTool('geo')
    drag(editor, [[10, 10], [80, 80]])
    const [s] = editor.store.shapes()
    editor.setSelection([s.id])
    editor.setStyle('color', 'red')
    editor.setStyle('fill', 'solid')
    const after = editor.store.get(s.id)
    expect(after.props.color).toBe('red')
    expect(after.props.fill).toBe('solid')
    expect(editor.styles.color).toBe('red')
  })

  it('currentStyles reports mixed values as null', () => {
    editor.setTool('geo')
    drag(editor, [[10, 10], [80, 80]])
    editor.setTool('geo')
    drag(editor, [[100, 10], [180, 80]])
    const [a, b] = editor.store.shapes()
    editor.store.update(a.id, { props: { color: 'blue' } })
    editor.store.update(b.id, { props: { color: 'green' } })
    editor.setSelection([a.id, b.id])
    expect(editor.currentStyles().color).toBeNull()
  })
})

describe('readonly & theme', () => {
  it('readonly blocks input', () => {
    editor.setReadonly(true)
    editor.setTool('draw')
    drag(editor, [[10, 10], [60, 60]])
    expect(editor.store.shapes().length).toBe(0)
  })

  it('theme switches live and reflects on the container', () => {
    editor.setTheme('dark')
    expect(editor.theme.id).toBe('dark')
    expect(container.dataset.qdTheme).toBe('dark')
  })
})

// a ctx that remembers what it was asked to draw, so the lattice can be
// checked by geometry rather than by eye
function recordingCtx() {
  const calls = []
  const ctx = { globalAlpha: 1, lineWidth: 1, fillStyle: '', strokeStyle: '', calls }
  for (const fn of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'arc', 'setTransform']) {
    ctx[fn] = (...a) => calls.push([fn, ...a])
  }
  ctx.stroke = () => calls.push(['stroke', ctx.strokeStyle, ctx.globalAlpha])
  ctx.fill = () => calls.push(['fill', ctx.fillStyle, ctx.globalAlpha])
  return ctx
}

describe('grid', () => {
  it('defaults to lines, switches, and emits', () => {
    const seen = []
    editor.on('grid', () => seen.push(editor.grid))
    expect(editor.grid).toBe('lines')
    editor.setGrid('none')
    editor.setGrid('none') // no-op, no event
    editor.setGrid('nonsense') // rejected
    editor.setGrid('dots')
    expect(editor.grid).toBe('dots')
    expect(seen).toEqual(['none', 'dots'])
  })

  it('draws nothing when off', () => {
    editor.setGrid('none')
    const ctx = recordingCtx()
    editor._drawGrid(ctx, { x: 0, y: 0, z: 1 }, 400, 300, 1)
    expect(ctx.calls.length).toBe(0)
  })

  it('rules the frame at the base step, majors every fifth', () => {
    editor.setGrid('lines')
    const ctx = recordingCtx()
    // 400x200 device px at zoom 1 → 40px steps: 11 columns (0..400), 6 rows
    editor._drawGrid(ctx, { x: 0, y: 0, z: 1 }, 400, 200, 1)
    const verticals = ctx.calls.filter((c) => c[0] === 'moveTo' && c[2] === 0).map((c) => c[1])
    expect(verticals.sort((a, b) => a - b)).toEqual([0.5, 40.5, 80.5, 120.5, 160.5, 200.5, 240.5, 280.5, 320.5, 360.5, 400.5])
    // two passes: minor then major, the majors darker
    const strokes = ctx.calls.filter((c) => c[0] === 'stroke')
    expect(strokes.length).toBe(2)
    expect(strokes[0][1]).toBe(editor.theme.grid.line.minor)
    expect(strokes[1][1]).toBe(editor.theme.grid.line.major)
  })

  it('doubles the step as you zoom out, halves it as you zoom in', () => {
    editor.setGrid('lines')
    const stepAt = (z) => {
      const ctx = recordingCtx()
      editor._drawGrid(ctx, { x: 0, y: 0, z }, 800, 400, 1)
      const xs = [...new Set(ctx.calls.filter((c) => c[0] === 'moveTo' && c[2] === 0).map((c) => c[1]))]
      xs.sort((a, b) => a - b)
      return (xs[1] - xs[0]) / z // back to page units
    }
    expect(stepAt(1)).toBe(40)
    expect(stepAt(0.3)).toBe(80) // doubled once: 80 * 0.3 = 24px on screen
    expect(stepAt(3)).toBe(20)
  })

  it('dots mark intersections in one uniform weight and ink', () => {
    editor.setGrid('dots')
    const ctx = recordingCtx()
    editor._drawGrid(ctx, { x: 0, y: 0, z: 1 }, 400, 200, 1)
    const arcs = ctx.calls.filter((c) => c[0] === 'arc')
    expect(arcs.length).toBe(11 * 6)
    const radii = [...new Set(arcs.map((c) => c[3]))]
    expect(radii).toEqual([1.6])
    // dots carry less ink than rules, so they run darker to read as calm
    const fills = ctx.calls.filter((c) => c[0] === 'fill')
    expect(fills.length).toBe(1)
    expect(fills[0][1]).toBe(editor.theme.grid.dot.minor)
  })

  it('travels with the camera', () => {
    editor.setGrid('lines')
    const ctx = recordingCtx()
    editor._drawGrid(ctx, { x: 10, y: 0, z: 1 }, 100, 100, 1)
    const verticals = ctx.calls.filter((c) => c[0] === 'moveTo' && c[2] === 0).map((c) => c[1])
    expect(verticals.sort((a, b) => a - b)).toEqual([10.5, 50.5, 90.5])
  })
})

describe('clear board', () => {
  it('⇧⌘⌫ empties the board in one undoable step', () => {
    editor.setTool('draw')
    drag(editor, [[10, 10], [40, 40]])
    drag(editor, [[60, 10], [90, 40]])
    expect(editor.store.shapes().length).toBe(2)

    editor._keyDown({
      key: 'Backspace', metaKey: true, shiftKey: true, ctrlKey: false,
      preventDefault() {}, stopPropagation() {},
    })
    expect(editor.store.shapes().length).toBe(0)

    editor.store.undo()
    expect(editor.store.shapes().length).toBe(2)
  })

  it('plain ⌫ still only deletes the selection', () => {
    editor.setTool('draw')
    drag(editor, [[10, 10], [40, 40]])
    drag(editor, [[60, 10], [90, 40]])
    editor.setSelection([editor.store.shapes()[0].id])
    editor._keyDown({
      key: 'Backspace', metaKey: false, shiftKey: false, ctrlKey: false,
      preventDefault() {}, stopPropagation() {},
    })
    expect(editor.store.shapes().length).toBe(1)
  })

  it('clearBoard on an empty board is a no-op (nothing to undo)', () => {
    editor.clearBoard()
    expect(editor.store.canUndo).toBe(false)
  })
})

describe('laser', () => {
  it('scribbles are ephemeral (never in the store)', () => {
    editor.setTool('laser')
    drag(editor, [[10, 10], [50, 50], [90, 30]])
    expect(editor.store.shapes().length).toBe(0)
    expect(editor.getScribbles().length).toBe(1)
    expect(editor.getScribbles()[0].points.length).toBe(3)
  })
})

describe('export', () => {
  it('exportImage yields a blob for a non-empty board, null when empty', async () => {
    expect(await editor.exportImage()).toBeNull()
    editor.setTool('geo')
    drag(editor, [[10, 10], [80, 80]])
    const blob = await editor.exportImage({ background: true, scale: 2 })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/png')
  })
})

describe('events & lifecycle', () => {
  it('emits change/selection/tool events and unsubscribes cleanly', () => {
    const changes = vi.fn(), sel = vi.fn(), tool = vi.fn()
    const off = editor.on('change', changes)
    editor.on('selection', sel)
    editor.on('tool', tool)
    editor.setTool('geo')
    drag(editor, [[10, 10], [80, 80]])
    expect(changes).toHaveBeenCalled()
    expect(sel).toHaveBeenCalled()
    expect(tool).toHaveBeenCalled()
    const n = changes.mock.calls.length
    off()
    editor.store.undo()
    expect(changes.mock.calls.length).toBe(n)
  })

  it('destroy removes canvases and stops listening', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2 })
    expect(c2.querySelector('.qd-dock')).toBeTruthy()
    board.destroy()
    expect(c2.querySelector('canvas')).toBeNull()
    expect(c2.querySelector('.qd-dock')).toBeNull()
    c2.remove()
  })
})

describe('createQuickdraw UI', () => {
  it('builds the dock with tool buttons that switch tools', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2 })
    const drawBtn = c2.querySelector('.qd-dock button[data-name="draw"]')
    expect(drawBtn).toBeTruthy()
    drawBtn.click()
    expect(board.editor.tool).toBe('draw')
    expect(drawBtn.classList.contains('on')).toBe(true)
    board.destroy()
    c2.remove()
  })

  it('shows the watermark by default, linked to the site', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2 })
    const mark = c2.querySelector('.qd-watermark')
    expect(mark).toBeTruthy()
    expect(mark.href).toBe('https://tryquickdraw.com/')
    board.destroy()
    expect(c2.querySelector('.qd-watermark')).toBeNull()
    c2.remove()
  })

  it('watermark: false removes it; hideUi keeps it', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const bare = createQuickdraw({ container: c2, watermark: false })
    expect(c2.querySelector('.qd-watermark')).toBeNull()
    bare.destroy()
    const headless = createQuickdraw({ container: c2, hideUi: true })
    expect(c2.querySelector('.qd-watermark')).toBeTruthy()
    headless.destroy()
    c2.remove()
  })

  it('undo/redo buttons track history through full gestures', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2 })
    const btn = (n) => c2.querySelector(`.qd-actions button[data-name="${n}"]`)
    expect(btn('undo').disabled).toBe(true)

    board.editor.setTool('draw')
    drag(board.editor, [[10, 10], [40, 40], [80, 60]])
    // the stroke's batch closed: undo must light up without any other event
    expect(btn('undo').disabled).toBe(false)
    expect(btn('redo').disabled).toBe(true)

    btn('undo').click()
    expect(board.editor.store.shapes().length).toBe(0)
    expect(btn('redo').disabled).toBe(false)
    btn('redo').click()
    expect(board.editor.store.shapes().length).toBe(1)
    expect(btn('undo').disabled).toBe(false)
    expect(btn('redo').disabled).toBe(true)
    board.destroy()
    c2.remove()
  })

  it('duplicate/delete light up with a selection and act on it', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2 })
    const btn = (n) => c2.querySelector(`.qd-actions button[data-name="${n}"]`)
    expect(btn('duplicate').disabled).toBe(true)
    expect(btn('delete').disabled).toBe(true)

    board.editor.setTool('draw')
    drag(board.editor, [[10, 10], [40, 40], [80, 60]])
    const id = board.editor.store.shapes()[0].id
    board.editor.setSelection([id])
    expect(btn('duplicate').disabled).toBe(false)
    expect(btn('delete').disabled).toBe(false)

    btn('duplicate').click()
    expect(board.editor.store.shapes().length).toBe(2)
    btn('delete').click()
    expect(board.editor.store.shapes().length).toBe(1)
    expect(btn('duplicate').disabled).toBe(true)
    board.destroy()
    c2.remove()
  })

  it('the board menu switches theme and grid', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2 })
    c2.querySelector('.qd-dock button[data-name="menu"]').click()
    const seg = (label) => [...c2.querySelectorAll('.qd-menu-row')]
      .find((r) => r.textContent.trim().startsWith(label))
    const btns = (label) => [...seg(label).querySelectorAll('.qd-seg-btn')]

    expect(btns('Theme')[0].classList.contains('on')).toBe(true)
    btns('Theme')[1].click()
    expect(board.editor.theme.id).toBe('dark')
    expect(btns('Theme')[1].classList.contains('on')).toBe(true)

    // grid is a nested dropdown: the row shows the current value…
    expect(board.editor.grid).toBe('lines')
    const gridRow = c2.querySelector('.qd-has-sub')
    expect(gridRow.textContent).toContain('Grid')
    expect(gridRow.textContent).toContain('Lines')
    expect(gridRow.classList.contains('sub-open')).toBe(false)
    gridRow.click()
    expect(gridRow.classList.contains('sub-open')).toBe(true)
    // …and the flyout lists every backdrop with a check on the current one
    const options = [...gridRow.querySelectorAll('.qd-submenu .qd-menu-item')]
    expect(options.length).toBe(6)
    expect(options[1].querySelector('.qd-mi-check').innerHTML).not.toBe('')
    options[0].click()
    expect(board.editor.grid).toBe('none')
    options[3].click()
    expect(board.editor.grid).toBe('dots')
    options[5].click()
    expect(board.editor.grid).toBe('iso')
    // picking keeps the flyout open and refreshes the check + parent value
    expect(gridRow.classList.contains('sub-open')).toBe(true)
    expect(options[5].querySelector('.qd-mi-check').innerHTML).not.toBe('')
    expect(options[1].querySelector('.qd-mi-check').innerHTML).toBe('')
    expect(gridRow.querySelector('.qd-mi-value').textContent).toBe('Isometric')
    // tapping the parent row again folds the flyout
    gridRow.click()
    expect(gridRow.classList.contains('sub-open')).toBe(false)

    board.destroy()
    c2.remove()
  })

  it('a host can drop the theme/grid switches', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2, themeToggle: false, gridControl: false })
    c2.querySelector('.qd-dock button[data-name="menu"]').click()
    expect(c2.querySelectorAll('.qd-menu-row').length).toBe(0)
    // and back on again, live
    board.ui.setOptions({ gridControl: true })
    c2.querySelector('.qd-dock button[data-name="menu"]').click()
    const gridRow = [...c2.querySelectorAll('.qd-menu-item')]
      .find((r) => r.textContent.trim().startsWith('Grid'))
    expect(gridRow).toBeTruthy()
    expect(c2.querySelectorAll('.qd-menu-row').length).toBe(0) // theme still off
    board.destroy()
    c2.remove()
  })

  it('the menu clears the board', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2 })
    board.editor.setTool('draw')
    drag(board.editor, [[10, 10], [40, 40]])
    c2.querySelector('.qd-dock button[data-name="menu"]').click()
    const clear = [...c2.querySelectorAll('.qd-menu-item')]
      .find((b) => b.textContent.includes('Clear board'))
    expect(clear.textContent).toContain('⇧⌘⌫')
    clear.click()
    expect(board.editor.store.shapes().length).toBe(0)
    board.destroy()
    c2.remove()
  })

  it('hideUi hides the chrome; readonly does too', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2, hideUi: true })
    expect(c2.querySelector('.qd-ui').classList.contains('qd-hidden')).toBe(true)
    board.destroy()
    c2.remove()
  })
})

describe('keyboard help overlay', () => {
  const press = (board, key) =>
    board.editor._keyDown({ key, shiftKey: true, metaKey: false, ctrlKey: false, preventDefault() {} })

  it('? toggles the overlay, Esc closes it, destroy tears it down', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2 })
    const open = () => !!c2.querySelector('.qd-help-backdrop')

    press(board, '?')
    expect(open()).toBe(true)
    expect(c2.querySelectorAll('.qd-help-row').length).toBeGreaterThan(20)
    press(board, '?')
    expect(open()).toBe(false)

    press(board, '?')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(open()).toBe(false)

    press(board, '?')
    board.destroy()
    expect(document.querySelector('.qd-help-backdrop')).toBe(null)
    c2.remove()
  })

  it('stays quiet on a readonly board', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2, readonly: true })
    press(board, '?')
    expect(c2.querySelector('.qd-help-backdrop')).toBe(null)
    board.destroy()
    c2.remove()
  })
})

// ---- tldraw-style arrange / group / crop / drop / context menu --------------

const rectAt = (ed, x, y, w = 60, h = 40) => {
  ed.setTool('geo')
  drag(ed, [[x, y], [x + w, y + h]])
  const all = ed.store.shapes()
  return all[all.length - 1]
}
const press = (ed, key, over = {}) =>
  ed._keyDown({ key, code: over.code || '', shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, preventDefault() {}, ...over })

describe('groups', () => {
  it('⌘G groups the selection: clicking one member selects them all', () => {
    const a = rectAt(editor, 10, 10)
    const b = rectAt(editor, 200, 10)
    const c = rectAt(editor, 400, 10)
    editor.setSelection([a.id, b.id])
    expect(editor.canGroup()).toBe(true)
    press(editor, 'g', { metaKey: true })
    const gid = editor.store.get(a.id).groupId
    expect(gid).toBeTruthy()
    expect(editor.store.get(b.id).groupId).toBe(gid)
    expect(editor.store.get(c.id).groupId).toBeUndefined()
    expect(editor.canGroup()).toBe(false) // already exactly this group
    expect(editor.canUngroup()).toBe(true)
    // one undo step
    expect(editor.store.undos[editor.store.undos.length - 1].updated[a.id]).toBeTruthy()

    editor.setSelection([])
    drag(editor, [[10, 10]]) // click a's corner
    expect(new Set(editor.selection)).toEqual(new Set([a.id, b.id]))
    // marquee across a alone still brings b along (started well clear of the
    // selection's corner, which is a rotate zone for a mouse)
    drag(editor, [[-40, -40], [90, 60]])
    expect(new Set(editor.selection)).toEqual(new Set([a.id, b.id]))
    // shift-click c adds it; shift-click a's top edge (clear of the selection
    // box's corner handle) removes the whole group
    drag(editor, [[400, 10]], { shiftKey: true })
    expect(editor.selection.size).toBe(3)
    drag(editor, [[30, 10]], { shiftKey: true })
    expect([...editor.selection]).toEqual([c.id])
  })

  it('double-click dives into a group; Esc steps back out; ⇧⌘G dissolves it', () => {
    const a = rectAt(editor, 10, 10)
    const b = rectAt(editor, 200, 10)
    editor.setSelection([a.id, b.id])
    editor.groupSelection()
    const gid = editor.store.get(a.id).groupId
    editor._dblClick({ clientX: 10, clientY: 10 })
    expect(editor.focusedGroup).toBe(gid)
    expect([...editor.selection]).toEqual([a.id])
    // inside the group, members pick one at a time
    drag(editor, [[200, 10]])
    expect([...editor.selection]).toEqual([b.id])
    press(editor, 'Escape')
    expect(editor.focusedGroup).toBe(null)
    expect(editor.selection.size).toBe(2)
    press(editor, 'g', { metaKey: true, shiftKey: true })
    expect(editor.store.get(a.id).groupId).toBeUndefined()
    expect('groupId' in editor.store.get(b.id)).toBe(false)
    expect(editor.canUngroup()).toBe(false)
  })

  it('duplicating a group makes a new group; grouping groups merges them', () => {
    const a = rectAt(editor, 10, 10)
    const b = rectAt(editor, 200, 10)
    editor.setSelection([a.id, b.id])
    editor.groupSelection()
    const gid = editor.store.get(a.id).groupId
    editor.duplicateSelection()
    const copies = [...editor.selection].map((id) => editor.store.get(id))
    expect(copies.length).toBe(2)
    expect(copies[0].groupId).toBe(copies[1].groupId)
    expect(copies[0].groupId).not.toBe(gid)
    // select one shape of each group and group again: four members, one id
    editor.setSelection([a.id, copies[0].id])
    editor.groupSelection()
    expect(editor.selection.size).toBe(4)
    const ids = new Set(editor.store.shapes().map((s) => s.groupId))
    expect(ids.size).toBe(1)
  })

  it('a group moves, deletes and restyles as one', () => {
    const a = rectAt(editor, 10, 10)
    const b = rectAt(editor, 200, 10)
    editor.setSelection([a.id, b.id])
    editor.groupSelection()
    editor.setSelection([])
    // press a's top edge and drag: b comes along
    drag(editor, [[30, 14], [70, 64]])
    expect(editor.store.get(b.id).x).toBeCloseTo(b.x + 40)
    expect(editor.store.get(b.id).y).toBeCloseTo(b.y + 50)
    editor.setStyle('color', 'red')
    expect(editor.store.get(b.id).props.color).toBe('red')
    editor.deleteSelection()
    expect(editor.store.shapes().length).toBe(0)
  })
})

describe('z order', () => {
  it('bringForward / sendBackward step past one neighbour, keeping the block order', () => {
    const a = rectAt(editor, 10, 10)
    const b = rectAt(editor, 20, 20)
    const c = rectAt(editor, 30, 30)
    const d = rectAt(editor, 40, 40)
    const order = () => editor.shapesSorted().map((s) => s.id)
    expect(order()).toEqual([a.id, b.id, c.id, d.id])
    editor.setSelection([a.id])
    press(editor, ']')
    expect(order()).toEqual([b.id, a.id, c.id, d.id])
    // only the moved shape changed
    const last = editor.store.undos[editor.store.undos.length - 1]
    expect(Object.keys(last.updated)).toEqual([a.id])
    press(editor, ']')
    expect(order()).toEqual([b.id, c.id, a.id, d.id])
    press(editor, '[')
    expect(order()).toEqual([b.id, a.id, c.id, d.id])
    // a block of two hops together
    editor.setSelection([a.id, c.id])
    editor.bringForward()
    expect(order()).toEqual([b.id, d.id, a.id, c.id])
    editor.bringForward() // already on top: nothing to do
    expect(order()).toEqual([b.id, d.id, a.id, c.id])
    editor.sendBackward()
    expect(order()).toEqual([b.id, a.id, c.id, d.id])
    // shifted brackets go all the way
    press(editor, '}')
    expect(order()).toEqual([b.id, d.id, a.id, c.id])
    press(editor, '[', { shiftKey: true })
    expect(order()).toEqual([a.id, c.id, b.id, d.id])
  })

  it('highlights reorder like any other shape', () => {
    const a = rectAt(editor, 10, 10)
    editor.setTool('highlight')
    drag(editor, [[10, 20], [60, 70]])
    const h = editor.store.shapes().find((s) => s.type === 'highlight')
    editor.setSelection([h.id])
    editor.sendToBack()
    expect(editor.shapesSorted().map((s) => s.id)).toEqual([h.id, a.id])
    editor.bringToFront()
    expect(editor.shapesSorted().map((s) => s.id)).toEqual([a.id, h.id])
  })

  it('a gap split too many times is renormalized rather than lost', () => {
    const a = rectAt(editor, 10, 10)
    const b = rectAt(editor, 20, 20)
    const c = rectAt(editor, 30, 30)
    editor.store.update(a.id, { z: 1 })
    editor.store.update(b.id, { z: 1 + 1e-9 })
    editor.store.update(c.id, { z: 1 + 2e-9 })
    editor.setSelection([a.id])
    editor.bringForward()
    const zs = editor.shapesSorted().map((s) => s.z)
    expect(editor.shapesSorted().map((s) => s.id)).toEqual([b.id, a.id, c.id])
    expect(zs[1] - zs[0]).toBeGreaterThan(0.1)
    expect(zs[2] - zs[1]).toBeGreaterThan(0.1)
  })
})

describe('align & distribute', () => {
  it('aligns on page bounds, in one undo step', () => {
    const a = rectAt(editor, 10, 10, 60, 40)
    const b = rectAt(editor, 200, 100, 30, 80)
    const c = rectAt(editor, 400, 50, 100, 20)
    editor.selectAll()
    const n = editor.store.undos.length
    editor.alignSelection('left')
    expect(editor.store.shapes().map((s) => s.x)).toEqual([10, 10, 10])
    expect(editor.store.undos.length).toBe(n + 1)
    editor.alignSelection('right')
    for (const s of editor.store.shapes()) expect(s.x + s.props.w).toBeCloseTo(110)
    editor.alignSelection('center')
    for (const s of editor.store.shapes()) expect(s.x + s.props.w / 2).toBeCloseTo(60)
    editor.alignSelection('top')
    expect(editor.store.shapes().map((s) => s.y)).toEqual([10, 10, 10])
    editor.alignSelection('bottom')
    for (const s of editor.store.shapes()) expect(s.y + s.props.h).toBeCloseTo(90)
    editor.alignSelection('middle')
    for (const s of editor.store.shapes()) expect(s.y + s.props.h / 2).toBeCloseTo(50)
    // one unit: nothing to line up with
    editor.setSelection([a.id])
    const before = editor.store.get(a.id)
    editor.alignSelection('left')
    expect(editor.store.get(a.id)).toBe(before)
    expect(b.id && c.id).toBeTruthy()
  })

  it('⌥ keys align, a group counts as one unit', () => {
    const a = rectAt(editor, 10, 10)
    const b = rectAt(editor, 100, 10)
    const c = rectAt(editor, 300, 200)
    editor.setSelection([a.id, b.id])
    editor.groupSelection()
    editor.selectAll()
    press(editor, 'å', { altKey: true, code: 'KeyA' })
    // the group slides as a block: a lands on the left edge, b keeps its offset
    expect(editor.store.get(a.id).x).toBe(10)
    expect(editor.store.get(b.id).x).toBe(100)
    expect(editor.store.get(c.id).x).toBe(10)
    press(editor, '∂', { altKey: true, code: 'KeyD' })
    expect(editor.store.get(c.id).x).toBe(100) // right edge = b's right edge
    expect(editor.store.get(a.id).x).toBe(10)
  })

  it('distribute spaces the middles evenly, the outer two staying put', () => {
    const a = rectAt(editor, 0, 0, 20, 20)
    const b = rectAt(editor, 30, 0, 20, 20)
    const c = rectAt(editor, 200, 0, 20, 20)
    editor.selectAll()
    editor.distributeSelection('horizontal')
    expect(editor.store.get(a.id).x).toBe(0)
    expect(editor.store.get(c.id).x).toBe(200)
    expect(editor.store.get(b.id).x).toBeCloseTo(100)
    // vertical, via the key
    editor.store.update(b.id, { y: 500 })
    editor.store.update(c.id, { y: 100 })
    press(editor, 'V', { altKey: true, shiftKey: true, code: 'KeyV' })
    expect(editor.store.get(a.id).y).toBe(0)
    expect(editor.store.get(b.id).y).toBe(500)
    expect(editor.store.get(c.id).y).toBeCloseTo(250)
  })
})

describe('image crop', () => {
  const addImage = (ed, x = 0, y = 0, w = 100, h = 100, rot = 0) => {
    const assetId = 'asset:t'
    ed.store.transact(() => {
      ed.store.put({ id: assetId, typeName: 'asset', src: 'data:image/png;base64,ZmFrZQ==', w: 400, h: 400 })
      ed.store.put({ id: 'img', typeName: 'shape', type: 'image', x, y, rot, z: 1, props: { w, h, assetId } })
    })
    return ed.store.get('img')
  }

  it('Enter opens crop mode on a selected image; handles trim, a drag inside slides the picture', () => {
    addImage(editor)
    editor.setTool('select')
    editor.setSelection(['img'])
    press(editor, 'Enter')
    expect(editor.cropping).toEqual({ id: 'img' })
    const undos = editor.store.undos.length
    // right handle in by 40
    drag(editor, [[100, 50], [60, 50]])
    let s = editor.store.get('img')
    expect(s.props.w).toBeCloseTo(60)
    expect(s.props.crop).toEqual({ x: 0, y: 0, w: 0.6, h: 1 })
    // left handle in by 20: the box moves with it
    drag(editor, [[0, 50], [20, 50]])
    s = editor.store.get('img')
    expect(s.x).toBeCloseTo(20)
    expect(s.props.w).toBeCloseTo(40)
    expect(s.props.crop.x).toBeCloseTo(0.2)
    expect(s.props.crop.w).toBeCloseTo(0.4)
    // slide the picture 10 left behind the (unmoved) window
    drag(editor, [[40, 50], [30, 50]])
    s = editor.store.get('img')
    expect(s.x).toBeCloseTo(20)
    expect(s.props.crop.x).toBeCloseTo(0.3)
    expect(s.props.crop.w).toBeCloseTo(0.4)
    // …but never past its edge
    drag(editor, [[40, 50], [400, 50]])
    expect(editor.store.get('img').props.crop.x).toBeCloseTo(0)
    // still cropping, nothing on the undo stack yet: the whole session is one step
    expect(editor.cropping).toBeTruthy()
    expect(editor.store.undos.length).toBe(undos)
    press(editor, 'Escape')
    expect(editor.cropping).toBe(null)
    expect(editor.store.undos.length).toBe(undos + 1)
    editor.store.undo()
    expect(editor.store.get('img').props.crop).toBeUndefined()
    expect(editor.store.get('img').props.w).toBe(100)
  })

  it('a rotated image keeps its window pinned while cropping; resetCrop restores the picture', () => {
    const rot = Math.PI / 2 // a quarter turn: local +x is page +y
    addImage(editor, 0, 0, 100, 100, rot)
    editor.startCrop('img')
    // the 'r' handle (local 100,50) sits at page (50,100) after the turn;
    // drag it "in" — down-screen is local -x here — by 40
    drag(editor, [[50, 100], [50, 60]])
    const s = editor.store.get('img')
    expect(s.props.w).toBeCloseTo(60)
    expect(s.props.crop.w).toBeCloseTo(0.6)
    // the window's left edge (local x=0) still lands at page y=0, the
    // picture didn't jump: window centre = rotated centre of local (30, 50)
    const cx = s.x + s.props.w / 2, cy = s.y + s.props.h / 2
    expect(cx).toBeCloseTo(50) // rotWith(30,50 about 50,50 by 90°) = (50, 30)
    expect(cy).toBeCloseTo(30)
    editor.endCrop()
    editor.resetCrop('img')
    const r = editor.store.get('img')
    expect(r.props.crop).toBeUndefined()
    expect(r.props.w).toBeCloseTo(100)
    expect(r.x + r.props.w / 2).toBeCloseTo(50)
    expect(r.y + r.props.h / 2).toBeCloseTo(50)
  })

  it('double-click toggles crop mode; a press off the picture ends it; a tool switch too', () => {
    addImage(editor, 100, 100)
    editor.setTool('select')
    editor._dblClick({ clientX: 150, clientY: 150 })
    expect(editor.cropping?.id).toBe('img')
    drag(editor, [[400, 400]])
    expect(editor.cropping).toBe(null)
    editor.startCrop('img')
    editor.setTool('draw')
    expect(editor.cropping).toBe(null)
    // the crop event brackets the mode
    const got = []
    editor.on('crop', () => got.push(!!editor.cropping))
    editor.startCrop('img')
    editor.endCrop()
    expect(got).toEqual([true, false])
  })
})

describe('drop from the toolbar', () => {
  it('dropShape lands a ready-made shape centred on the point, selected, in the current styles', () => {
    editor.setStyle('color', 'green')
    const id = editor.dropShape('geo', { x: 200, y: 200 })
    const s = editor.store.get(id)
    expect(s.type).toBe('geo')
    expect(s.props.geo).toBe('rectangle')
    expect([s.x, s.y, s.props.w, s.props.h]).toEqual([120, 120, 160, 160])
    expect(s.props.color).toBe('green')
    expect(editor.tool).toBe('select')
    expect([...editor.selection]).toEqual([id])
    const star = editor.store.get(editor.dropShape('star', { x: 0, y: 0 }))
    expect(star.props.geo).toBe('star')
    const arrow = editor.store.get(editor.dropShape('arrow', { x: 100, y: 50 }))
    expect(arrow.type).toBe('arrow')
    expect(arrow.x).toBe(20)
    expect(arrow.props.dx).toBe(160)
    expect(arrow.props.dash).toBe('solid')
    // text and notes open for typing straight away
    const t = editor.dropShape('text', { x: 10, y: 10 })
    expect(editor.store.get(t).type).toBe('text')
    expect(editor.editing?.id).toBe(t)
    expect(editor.dropShape('nope', { x: 0, y: 0 })).toBe(null)
  })

  it('pulling the shape tool off the dock drops it on the board; a plain click still picks the tool', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    c2.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 })
    const board = createQuickdraw({ container: c2 })
    const btn = c2.querySelector('.qd-dock button[data-name="geo"]')
    const fire = (type, x, y) => btn.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }))
    fire('pointerdown', 400, 580)
    fire('pointermove', 402, 578) // under the threshold: no ghost yet
    expect(c2.querySelector('.qd-drag-ghost')).toBe(null)
    fire('pointermove', 300, 300)
    expect(c2.querySelector('.qd-drag-ghost')).toBeTruthy()
    fire('pointerup', 300, 300)
    fire('click', 300, 300)
    expect(c2.querySelector('.qd-drag-ghost')).toBe(null)
    const [s] = board.editor.store.shapes()
    expect(s.type).toBe('geo')
    expect([s.x, s.y]).toEqual([220, 220])
    expect(board.editor.tool).toBe('select') // the drag's click didn't arm the tool
    // a plain click arms it as before
    fire('pointerdown', 400, 580)
    fire('pointerup', 400, 580)
    fire('click', 400, 580)
    expect(board.editor.tool).toBe('geo')
    expect(board.editor.store.shapes().length).toBe(1)
    // a drop back on the chrome is a change of mind
    fire('pointerdown', 400, 580)
    fire('pointermove', 300, 300)
    fire('pointercancel', 300, 300)
    expect(board.editor.store.shapes().length).toBe(1)
    board.destroy()
    c2.remove()
  })
})

describe('context menu', () => {
  it('right-click selects the shape (with its group) under the pointer and emits contextmenu', () => {
    const a = rectAt(editor, 10, 10)
    const b = rectAt(editor, 200, 10)
    editor.setSelection([a.id, b.id])
    editor.groupSelection()
    editor.setSelection([])
    editor.setTool('draw')
    const got = []
    editor.on('contextmenu', (e) => got.push(e))
    let prevented = false
    editor._contextMenu({ target: editor.canvas, clientX: 10, clientY: 10, preventDefault() { prevented = true } })
    expect(prevented).toBe(true)
    expect(got.length).toBe(1)
    expect(got[0].hit.id).toBe(a.id)
    expect(got[0].page).toEqual({ x: 10, y: 10 })
    expect(editor.tool).toBe('select')
    expect(editor.selection.size).toBe(2)
    // over empty paper the selection clears
    editor._contextMenu({ target: editor.canvas, clientX: 500, clientY: 500, preventDefault() {} })
    expect(got[1].hit).toBe(null)
    expect(editor.selection.size).toBe(0)
    // readonly boards keep the browser's menu
    editor.setReadonly(true)
    editor._contextMenu({ target: editor.canvas, clientX: 10, clientY: 10, preventDefault() {} })
    expect(got.length).toBe(2)
  })

  it('a long press with a finger opens it too', () => {
    vi.useFakeTimers()
    try {
      const a = rectAt(editor, 10, 10)
      editor.setSelection([])
      const got = []
      editor.on('contextmenu', (e) => got.push(e))
      pid++
      editor._pointerDown({ ...ev(12, 12, { pointerType: 'touch' }), target: editor.canvas })
      vi.advanceTimersByTime(300)
      expect(got.length).toBe(0)
      vi.advanceTimersByTime(300)
      expect(got.length).toBe(1)
      expect(got[0].hit.id).toBe(a.id)
      expect(editor.session).toBe(null)
      editor._pointerUp({ ...ev(12, 12, { pointerType: 'touch' }), target: editor.canvas })
      // a finger that travels is a drag, not a press
      pid++
      editor._pointerDown({ ...ev(12, 12, { pointerType: 'touch' }), target: editor.canvas })
      editor._pointerMove({ ...ev(60, 60, { pointerType: 'touch' }), target: editor.canvas })
      vi.advanceTimersByTime(700)
      expect(got.length).toBe(1)
      editor._pointerUp({ ...ev(60, 60, { pointerType: 'touch' }), target: editor.canvas })
    } finally {
      vi.useRealTimers()
    }
  })

  it('the stock UI shows a menu at the pointer that acts on the selection', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2 })
    const ed = board.editor
    const menu = () => c2.querySelector('.qd-popover.qd-ctx')
    const items = () => [...menu().querySelectorAll('.qd-menu-item')]
    const find = (label) => items().find((b) => b.querySelector('.qd-mi-label')?.textContent === label)

    // empty paper: the board's own actions
    ed._openContextMenu({ x: 300, y: 300 })
    expect(menu()).toBeTruthy()
    expect(find('Select all')).toBeTruthy()
    expect(find('Select all').disabled).toBe(true) // nothing to select yet
    expect(find('Group')).toBeUndefined()
    expect(menu().style.left).toBe('302px')
    // Esc closes it
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(menu()).toBe(null)

    const a = rectAt(ed, 10, 10)
    const b = rectAt(ed, 200, 10)
    ed.setSelection([a.id])
    ed._openContextMenu({ x: 10, y: 10 })
    expect(find('Group').disabled).toBe(true) // one shape can't group
    expect(find('Ungroup').disabled).toBe(true)
    expect(find('Align').classList.contains('qd-off')).toBe(true)
    expect(find('Reorder')).toBeTruthy()
    expect(find('Bring forward')).toBeTruthy() // the flyout is built up front
    expect(find('Edit text')).toBeTruthy() // a geo carries a label

    ed.setSelection([a.id, b.id])
    ed._openContextMenu({ x: 10, y: 10 })
    expect(find('Group').disabled).toBe(false)
    expect(find('Align').classList.contains('qd-off')).toBe(false)
    expect(find('Distribute horizontally').disabled).toBe(true) // needs three
    find('Group').click()
    expect(menu()).toBe(null)
    expect(ed.store.get(a.id).groupId).toBeTruthy()

    ed._openContextMenu({ x: 10, y: 10 })
    find('Delete').click()
    expect(ed.store.shapes().length).toBe(0)
    board.destroy()
    expect(document.querySelector('.qd-ctx')).toBe(null)
    c2.remove()
  })
})

describe('rotated resize', () => {
  it('a rotated shape shows handles on its own frame and resizes in it, the far edge anchored', () => {
    const a = rectAt(editor, 100, 100, 100, 60) // centre 150,130
    editor.store.update(a.id, { rot: Math.PI / 2 })
    editor.setSelection([a.id])
    // local right-middle (100,30) → page: rotate about (150,130) by 90° → (150,180)
    expect(editor._hitHandle(150, 180)).toEqual({ kind: 'resize', which: 'r' })
    // local top-left (0,0) → (180,80)
    expect(editor._hitHandle(180, 80)).toEqual({ kind: 'resize', which: 'tl' })
    // drag the local right edge outwards by 40 (page +y): width grows, height and the left edge stay
    drag(editor, [[150, 180], [150, 220]])
    const s = editor.store.get(a.id)
    expect(s.props.w).toBeCloseTo(140)
    expect(s.props.h).toBeCloseTo(60)
    expect(s.rot).toBeCloseTo(Math.PI / 2)
    // the anchored left edge (local x=0) still maps to page y=80: centre moved by +20 along page y
    expect(s.x + s.props.w / 2).toBeCloseTo(150)
    expect(s.y + s.props.h / 2).toBeCloseTo(150)
    // one undo step
    editor.store.undo()
    expect(editor.store.get(a.id).props.w).toBeCloseTo(100)
  })

  it('a corner keeps the far corner fixed; shift makes it uniform', () => {
    const a = rectAt(editor, 100, 100, 100, 60)
    editor.store.update(a.id, { rot: Math.PI })
    editor.setSelection([a.id])
    // upside down: local br (100,60) sits at page tl (100,100)
    expect(editor._hitHandle(100, 100)).toEqual({ kind: 'resize', which: 'br' })
    drag(editor, [[100, 100], [70, 100]], { shiftKey: true }) // local +30 in x → uniform 1.3
    const s = editor.store.get(a.id)
    expect(s.props.w).toBeCloseTo(130)
    expect(s.props.h).toBeCloseTo(78)
    // local tl (0,0) → page (200,160) stays put: centre = (200 - 65, 160 - 39)
    expect(s.x + s.props.w / 2).toBeCloseTo(135)
    expect(s.y + s.props.h / 2).toBeCloseTo(121)
  })
})

describe('⌥ copy-drag', () => {
  it('alt is live: down = copy, up = back to a move; the drop keeps whatever is on', () => {
    const a = rectAt(editor, 10, 10)
    editor.setSelection([a.id])
    const undos = editor.store.undos.length
    pid++
    editor._pointerDown({ ...ev(30, 14), target: editor.canvas })
    editor._pointerMove({ ...ev(50, 34), target: editor.canvas })
    expect(editor.store.shapes().length).toBe(1)
    expect(editor.store.get(a.id).x).toBeCloseTo(30)
    // alt lands: the original goes home, a copy carries on under the pointer
    editor._pointerMove({ ...ev(70, 54, { altKey: true }), target: editor.canvas })
    expect(editor.store.shapes().length).toBe(2)
    expect(editor.store.get(a.id).x).toBeCloseTo(10)
    let copy = editor.store.shapes().find((s) => s.id !== a.id)
    expect(copy.x).toBeCloseTo(50)
    expect([...editor.selection]).toEqual([copy.id])
    // alt released before the drop: the copy goes away, the original is back under the pointer
    editor._pointerMove({ ...ev(90, 74), target: editor.canvas })
    expect(editor.store.shapes().length).toBe(1)
    expect(editor.store.get(a.id).x).toBeCloseTo(70)
    expect([...editor.selection]).toEqual([a.id])
    // alt again, then the button comes up with it held: the copy is committed
    editor._pointerMove({ ...ev(110, 94, { altKey: true }), target: editor.canvas })
    editor._pointerUp({ ...ev(110, 94, { altKey: true }), target: editor.canvas })
    expect(editor.store.shapes().length).toBe(2)
    expect(editor.store.get(a.id).x).toBeCloseTo(10)
    copy = editor.store.shapes().find((s) => s.id !== a.id)
    expect(copy.x).toBeCloseTo(90)
    expect(editor.store.undos.length).toBe(undos + 1) // one clean step: the copy at its place
    editor.store.undo()
    expect(editor.store.shapes().length).toBe(1)
    expect(editor.store.get(a.id).x).toBeCloseTo(10)
  })

  it('the Alt key itself toggles it while dragging; a drop after letting go is a plain move', () => {
    const a = rectAt(editor, 10, 10)
    editor.setSelection([a.id])
    const undos = editor.store.undos.length
    pid++
    editor._pointerDown({ ...ev(30, 14), target: editor.canvas })
    editor._pointerMove({ ...ev(50, 34), target: editor.canvas })
    press(editor, 'Alt', { altKey: true })
    expect(editor.store.shapes().length).toBe(2)
    expect(editor.store.get(a.id).x).toBeCloseTo(10)
    editor._keyUp({ key: 'Alt' })
    expect(editor.store.shapes().length).toBe(1)
    expect(editor.store.get(a.id).x).toBeCloseTo(30)
    editor._pointerUp({ ...ev(50, 34), target: editor.canvas })
    expect(editor.store.shapes().length).toBe(1)
    expect(editor.store.get(a.id).x).toBeCloseTo(30)
    expect(editor.store.undos.length).toBe(undos + 1)
    // that step is a pure move: no trace of the copy that came and went
    const last = editor.store.undos[editor.store.undos.length - 1]
    expect(Object.keys(last.added).length).toBe(0)
    expect(Object.keys(last.removed).length).toBe(0)
  })
})

describe('arrow bindings', () => {
  const box = (ed, id, x, y, w = 100, h = 100, over = {}) => {
    ed.store.put({ id, typeName: 'shape', type: 'geo', x, y, rot: 0, z: ed.store.maxZ() + 1, props: { geo: 'rectangle', w, h, color: 'black', size: 'm', dash: 'solid', fill: 'none', font: 'draw' }, ...over })
    return ed.store.get(id)
  }
  const arrowOf = (ed) => ed.store.shapes().find((s) => s.type === 'arrow')

  it('an arrow drawn from inside one box to inside another binds both ends on their outlines', () => {
    box(editor, 'a', 0, 0)
    box(editor, 'b', 300, 0)
    editor.setTool('arrow')
    drag(editor, [[50, 50], [200, 50], [350, 50]])
    const ar = arrowOf(editor)
    expect(ar.props.startBind).toEqual({ id: 'a', nx: 0.5, ny: 0.5 })
    expect(ar.props.endBind).toEqual({ id: 'b', nx: 0.5, ny: 0.5 })
    // start sits just outside a's right edge (x=100), the head just short of b's left edge (x=300)
    expect(ar.x).toBeCloseTo(100 + 2, 0)
    expect(ar.y).toBeCloseTo(50)
    expect(ar.x + ar.props.dx).toBeCloseTo(300 - 5.8, 0)
    expect(ar.y + ar.props.dy).toBeCloseTo(50)
    expect(editor.store.undos.length).toBe(3) // two boxes, one arrow gesture
  })

  it('the arrow follows its shapes — moves, resizes, rotations — in the same undo step', () => {
    box(editor, 'a', 0, 0)
    box(editor, 'b', 300, 0)
    editor.setTool('arrow')
    drag(editor, [[50, 50], [350, 50]])
    const before = arrowOf(editor)
    const n = editor.store.undos.length
    // move b down by 200: the head follows to b's new outline, the start swings to aim at it
    editor.setSelection(['b'])
    editor.store.transact(() => editor._nudge(['b'], 0, 200))
    let ar = arrowOf(editor)
    // the head sits on b's left edge (x=300, less the head gap along the
    // ray), somewhere along it — where the ray from a's centre to b's enters b
    expect(ar.x + ar.props.dx).toBeGreaterThan(292)
    expect(ar.x + ar.props.dx).toBeLessThan(300)
    expect(ar.y + ar.props.dy).toBeGreaterThan(200)
    expect(ar.y + ar.props.dy).toBeLessThan(300)
    expect(editor.store.undos.length).toBe(n + 1)
    const last = editor.store.undos[n]
    expect(Object.keys(last.updated).sort()).toEqual(['b', ar.id].sort())
    editor.store.undo()
    expect(arrowOf(editor)).toEqual(before)
    editor.store.redo()
    expect(arrowOf(editor).x + arrowOf(editor).props.dx).toBeLessThan(300)
    // a resize of a shifts the start: with a now 200 wide, the ray from b's
    // centre leaves a through its bottom edge (y=100) instead of its right
    editor.store.update('a', { props: { w: 200 } })
    ar = arrowOf(editor)
    expect(ar.y).toBeGreaterThan(100)
    expect(ar.y).toBeLessThan(104)
    expect(ar.x).toBeGreaterThan(100)
    expect(ar.x).toBeLessThan(200)
  })

  it('deleting a bound shape frees that end; the arrow stays', () => {
    box(editor, 'a', 0, 0)
    box(editor, 'b', 300, 0)
    editor.setTool('arrow')
    drag(editor, [[50, 50], [350, 50]])
    editor.store.remove(['b'])
    const ar = arrowOf(editor)
    expect(ar).toBeTruthy()
    expect(ar.props.endBind).toBeUndefined()
    expect(ar.props.startBind).toBeTruthy()
    editor.store.undo()
    expect(arrowOf(editor).props.endBind).toEqual({ id: 'b', nx: 0.5, ny: 0.5 })
  })

  it('dragging an end handle onto a shape ties it (⌥ = exact point); onto paper frees it', () => {
    box(editor, 'a', 0, 0)
    editor.setTool('arrow')
    drag(editor, [[300, 300], [400, 300]]) // free arrow, then selected
    const id = arrowOf(editor).id
    expect([...editor.selection]).toEqual([id])
    // drag the end (400,300) into a, near its centre: snaps to the centre
    drag(editor, [[400, 300], [60, 40]])
    let ar = editor.store.get(id)
    expect(ar.props.endBind).toEqual({ id: 'a', nx: 0.5, ny: 0.5 })
    expect(editor.bindHover).toBe(null) // cleared on release
    // the end now sits on a's outline, on the side facing the start
    expect(ar.x + ar.props.dx).toBeGreaterThan(100)
    expect(ar.x + ar.props.dx).toBeLessThan(110)
    // ⌥ keeps the exact point
    const end = { x: ar.x + ar.props.dx, y: ar.y + ar.props.dy }
    drag(editor, [[end.x, end.y], [90, 10]], { altKey: true })
    ar = editor.store.get(id)
    expect(ar.props.endBind.nx).toBeCloseTo(0.9)
    expect(ar.props.endBind.ny).toBeCloseTo(0.1)
    // back onto paper: free
    const e2 = { x: ar.x + ar.props.dx, y: ar.y + ar.props.dy }
    drag(editor, [[e2.x, e2.y], [500, 500]])
    ar = editor.store.get(id)
    expect(ar.props.endBind).toBeUndefined()
    expect(ar.x + ar.props.dx).toBeCloseTo(500)
  })

  it('a bound arrow dragged on its own lets go; dragged with its shape it stays tied; copies re-tie', () => {
    box(editor, 'a', 0, 0)
    box(editor, 'b', 300, 0)
    editor.setTool('arrow')
    drag(editor, [[50, 50], [350, 50]])
    const id = arrowOf(editor).id
    // move the arrow alone (press its shaft, clear of the bend handle at the
    // midpoint): both ties drop, it just moves
    editor.setSelection([id])
    drag(editor, [[160, 50], [160, 150]])
    let ar = editor.store.get(id)
    expect(ar.props.startBind).toBeUndefined()
    expect(ar.props.endBind).toBeUndefined()
    expect(ar.y).toBeCloseTo(150)
    editor.store.undo()
    ar = editor.store.get(id)
    expect(ar.props.startBind).toBeTruthy()
    // move arrow + b together (press b's left edge): the end stays tied and follows b
    editor.setSelection([id, 'b'])
    drag(editor, [[300, 80], [300, 280]])
    ar = editor.store.get(id)
    expect(ar.props.endBind.id).toBe('b')
    expect(ar.props.startBind).toBeUndefined() // a stayed behind, so that tie let go
    expect(ar.y + ar.props.dy).toBeCloseTo(250, 0)
    // duplicate arrow + b: the copy ties to the copied b, not the original
    editor.setSelection([id, 'b'])
    editor.duplicateSelection()
    const copies = [...editor.selection].map((i) => editor.store.get(i))
    const arCopy = copies.find((s) => s.type === 'arrow')
    const bCopy = copies.find((s) => s.type === 'geo')
    expect(arCopy.props.endBind.id).toBe(bCopy.id)
  })

  it('remote diffs skip reactors; local ones run them once per transaction', () => {
    box(editor, 'a', 0, 0)
    editor.store.put({ id: 'ar', typeName: 'shape', type: 'line', x: 300, y: 50, rot: 0, z: 5, props: { dx: -150, dy: 0, bend: 0, color: 'black', size: 'm', dash: 'solid', endBind: { id: 'a', nx: 0.5, ny: 0.5 } } })
    let ar = editor.store.get('ar')
    expect(ar.x + ar.props.dx).toBeCloseTo(102) // solved on put
    const diffs = []
    editor.store.listen((d) => diffs.push(d))
    editor.store.applyDiff({ added: {}, removed: {}, updated: { a: [editor.store.get('a'), { ...editor.store.get('a'), x: 50 }] } }, 'remote')
    expect(diffs.length).toBe(1)
    expect(Object.keys(diffs[0].updated)).toEqual(['a']) // the arrow was not touched locally
    expect(editor.store.get('ar').x + editor.store.get('ar').props.dx).toBeCloseTo(102)
  })
})

describe('rotate zones (mouse)', () => {
  it('a mouse has no knob: the zone just outside each corner rotates, with a rotate cursor', () => {
    const a = rectAt(editor, 100, 100, 100, 60)
    editor.setSelection([a.id])
    expect(editor._coarse).toBe(false)
    // no knob above the box
    expect(editor._hitHandle(150, 78)).toBe(null)
    // the resize handle wins right at the corner, the rotate zone sits past it
    expect(editor._hitHandle(96, 96)).toEqual({ kind: 'resize', which: 'tl' })
    const z = editor._hitHandle(86, 86)
    expect(z?.kind).toBe('rotate')
    expect(z.corner).toBe('tl')
    expect(z.cursor).toMatch(/^url\("data:image\/svg\+xml/)
    expect(editor._hitHandle(214, 174)?.corner).toBe('br')
    // inside the box near a corner is not a zone; far outside isn't either
    expect(editor._hitHandle(112, 112)).toBe(null)
    expect(editor._hitHandle(60, 60)).toBe(null)
    // hovering there shows the rotate cursor; dragging there rotates about
    // the centre, and the cursor turns along with the shape
    editor._hoverCursor({ target: editor.canvas, clientX: 86, clientY: 86 })
    expect(editor.container.style.cursor).toContain('data:image/svg+xml')
    const atRest = editor.container.style.cursor
    pid++
    editor._pointerDown({ ...ev(86, 86), target: editor.canvas })
    editor._pointerMove({ ...ev(150, 40), target: editor.canvas })
    expect(editor.container.style.cursor).toContain('data:image/svg+xml')
    expect(editor.container.style.cursor).not.toBe(atRest)
    editor._pointerUp({ ...ev(150, 40), target: editor.canvas })
    const s = editor.store.get(a.id)
    const turned = Math.atan2(40 - 130, 150 - 150) - Math.atan2(86 - 130, 86 - 150)
    expect(s.rot).toBeCloseTo(turned, 5)
    expect(s.x + s.props.w / 2).toBeCloseTo(150)
    expect(s.y + s.props.h / 2).toBeCloseTo(130)
    // a rotated shape's zones turn with it: its local top-left corner is now elsewhere
    const [, tl] = editor._resizeHandles(s, null).find(([w]) => w === 'tl')
    const ang = Math.atan2(tl.y - 130, tl.x - 150)
    const zone = editor._hitHandle(tl.x + Math.cos(ang) * 16, tl.y + Math.sin(ang) * 16)
    expect(zone?.kind).toBe('rotate')
  })

  it('a touch seen brings the knob back', () => {
    const a = rectAt(editor, 100, 100, 100, 60)
    editor.setSelection([a.id])
    pid++
    editor._pointerDown({ ...ev(400, 400, { pointerType: 'touch' }), target: editor.canvas })
    editor._pointerUp({ ...ev(400, 400, { pointerType: 'touch' }), target: editor.canvas })
    editor.setSelection([a.id])
    expect(editor._coarse).toBe(true)
    expect(editor._hitHandle(150, 78)?.kind).toBe('rotate')
  })
})

describe('hollow hits', () => {
  it('pressing inside an unfilled shape selects and moves it; the eraser still needs the edge', () => {
    const a = rectAt(editor, 100, 100, 200, 120)
    const inner = rectAt(editor, 150, 150, 40, 40) // a box inside the box
    editor.setSelection([])
    drag(editor, [[120, 200]]) // empty middle of a, outside inner
    expect([...editor.selection]).toEqual([a.id])
    drag(editor, [[170, 170]]) // inside both: the smaller wins
    expect([...editor.selection]).toEqual([inner.id])
    // drag from the empty middle moves it
    editor.setSelection([])
    drag(editor, [[120, 200], [140, 230]])
    expect(editor.store.get(a.id).x).toBeCloseTo(120)
    expect(editor.store.get(a.id).y).toBeCloseTo(130)
    // the eraser sweeping through the middle (a now spans 120..320 × 130..250,
    // the inner box 150..190) takes nothing
    editor.setTool('eraser')
    drag(editor, [[220, 200], [225, 205]])
    expect(editor.store.shapes().length).toBe(2)
    // a filled shape still hits everywhere, as before
    editor.setTool('select')
    editor.store.update(a.id, { props: { fill: 'solid' } })
    expect(editor.hitTest(220, 200, { inside: true })?.id).toBe(a.id)
    expect(editor.hitTest(220, 200)?.id).toBe(a.id)
  })

  it('pressing the empty space inside a group selects the group', () => {
    const a = rectAt(editor, 0, 0, 60, 60)
    const b = rectAt(editor, 300, 300, 60, 60)
    editor.setSelection([a.id, b.id])
    editor.groupSelection()
    editor.setSelection([])
    drag(editor, [[180, 180]]) // between the two members
    expect(editor.selection.size).toBe(2)
    drag(editor, [[180, 180], [200, 180]])
    expect(editor.store.get(a.id).x).toBeCloseTo(20)
    expect(editor.store.get(b.id).x).toBeCloseTo(320)
    // outside the group's frame: nothing
    drag(editor, [[500, 500]])
    expect(editor.selection.size).toBe(0)
  })
})

describe('resize pinning', () => {
  const text = (ed, x, y, t = 'hello world') => {
    ed.store.put({ id: 't', typeName: 'shape', type: 'text', x, y, rot: 0, z: 1, props: { text: t, color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1 } })
    return ed.store.get('t')
  }
  const note = (ed, x, y) => {
    ed.store.put({ id: 'n', typeName: 'shape', type: 'note', x, y, rot: 0, z: 1, props: { text: 'n', color: 'yellow', size: 'm', font: 'draw', scale: 1 } })
    return ed.store.get('n')
  }

  it('a side pull on text sets its wrap width; the far edge and the type size stay put', () => {
    const t = text(editor, 100, 100)
    editor.setTool('select')
    editor.setSelection(['t'])
    const b0 = pageBounds(t)
    expect(editor._hitHandle(b0.x + b0.w, b0.y + b0.h / 2)).toEqual({ kind: 'resize', which: 'r' })
    // pull the right edge in by 40
    drag(editor, [[b0.x + b0.w, b0.y + b0.h / 2], [b0.x + b0.w - 40, b0.y + b0.h / 2]])
    const s = editor.store.get('t')
    expect(s.props.autosize).toBe(false)
    expect(s.props.scale).toBe(1)
    expect(s.x).toBe(100) // left edge pinned
    expect(pageBounds(s).w).toBeCloseTo(b0.w - 40)
    // and from the left, the right edge is pinned
    const b1 = pageBounds(s)
    drag(editor, [[b1.x, b1.y + b1.h / 2], [b1.x + 20, b1.y + b1.h / 2]])
    const s2 = editor.store.get('t')
    expect(pageBounds(s2).x + pageBounds(s2).w).toBeCloseTo(b1.x + b1.w)
    expect(pageBounds(s2).w).toBeCloseTo(b1.w - 20)
  })

  it("a text box's top and bottom edges set its type size, the wrap width staying, the far edge pinned", () => {
    const t = text(editor, 100, 100, 'some words that wrap around')
    editor.store.update('t', { props: { autosize: false, w: 150 } })
    editor.setTool('select')
    editor.setSelection(['t'])
    const b0 = pageBounds(editor.store.get('t'))
    // the whole bottom edge is the handle, not just its midpoint
    expect(editor._hitHandle(b0.x + 10, b0.y + b0.h)).toEqual({ kind: 'resize', which: 'b' })
    expect(editor._hitHandle(b0.x + b0.w - 10, b0.y)).toEqual({ kind: 'resize', which: 't' })
    expect(editor._hitHandle(b0.x + 10, b0.y + b0.h / 2)).toBe(null)
    // pull the bottom down to half again as tall: the type grows, the width doesn't, the top stays
    drag(editor, [[b0.x + 10, b0.y + b0.h], [b0.x + 10, b0.y + b0.h * 1.5]])
    let s = editor.store.get('t')
    expect(s.props.scale).toBeCloseTo(1.5)
    expect(s.props.w).toBe(150)
    expect(s.x).toBe(100)
    expect(s.y).toBe(100)
    // pull the top up: the type grows and the bottom edge stays put exactly
    const b1 = pageBounds(s)
    drag(editor, [[b1.x + 20, b1.y], [b1.x + 20, b1.y - 30]])
    s = editor.store.get('t')
    expect(s.props.scale).toBeGreaterThan(1.5)
    expect(s.props.w).toBe(150)
    expect(pageBounds(s).y + pageBounds(s).h).toBeCloseTo(b1.y + b1.h)
    // and back down shrinks it
    const b2 = pageBounds(s)
    drag(editor, [[b2.x + 20, b2.y + b2.h], [b2.x + 20, b2.y + b2.h / 2]])
    expect(editor.store.get('t').props.scale).toBeLessThan(s.props.scale)
  })

  it('a note resizes freely: sides set width or height, corners both, the far edge pinned, the type unchanged', () => {
    const n = note(editor, 100, 100)
    editor.setTool('select')
    editor.setSelection(['n'])
    const b0 = pageBounds(n) // 200x200
    // wider, from the right: height and type stay, the text rewraps to the new width
    drag(editor, [[b0.x + b0.w, b0.y + b0.h / 2], [b0.x + b0.w + 100, b0.y + b0.h / 2]])
    let s = editor.store.get('n')
    expect(s.props.w).toBeCloseTo(300)
    expect(s.props.h).toBeCloseTo(200)
    expect(s.props.scale).toBe(1)
    expect(s.x).toBe(100)
    expect(pageBounds(s).h).toBeCloseTo(200)
    // shorter, from the bottom: a wide low sticky
    drag(editor, [[b0.x + 150, b0.y + 200], [b0.x + 150, b0.y + 120]])
    s = editor.store.get('n')
    expect(s.props.h).toBeCloseTo(120)
    expect(pageBounds(s).h).toBeCloseTo(120)
    // a corner pull grows both, the top-right corner staying
    const b1 = pageBounds(s)
    drag(editor, [[b1.x, b1.y + b1.h], [b1.x - 30, b1.y + b1.h + 50]])
    s = editor.store.get('n')
    const b2 = pageBounds(s)
    expect(b2.x + b2.w).toBeCloseTo(b1.x + b1.w)
    expect(b2.y).toBeCloseTo(b1.y)
    expect(b2.w).toBeCloseTo(b1.w + 30)
    expect(b2.h).toBeCloseTo(b1.h + 50)
    // but never shorter than its words: lots of text holds the box open
    editor.store.update('n', { props: { text: 'a sticky with far too many words to fit in a short box like this one', h: 40 } })
    expect(pageBounds(editor.store.get('n')).h).toBeGreaterThan(40)
  })

  it('⌥ resizes about the centre, unrotated and rotated', () => {
    const a = rectAt(editor, 100, 100, 100, 60) // centre 150,130
    editor.setSelection([a.id])
    drag(editor, [[200, 130], [240, 130]], { altKey: true })
    let s = editor.store.get(a.id)
    expect(s.props.w).toBeCloseTo(180)
    expect(s.x + s.props.w / 2).toBeCloseTo(150)
    expect(s.y).toBeCloseTo(100)
    editor.store.update(a.id, { rot: Math.PI / 2, props: { w: 100 } })
    editor.store.update(a.id, { x: 100 })
    // local right-middle now at page (150,180): pull out by 40 with ctrl
    drag(editor, [[150, 180], [150, 220]], { ctrlKey: true })
    s = editor.store.get(a.id)
    expect(s.props.w).toBeCloseTo(180)
    expect(s.x + s.props.w / 2).toBeCloseTo(150)
    expect(s.y + s.props.h / 2).toBeCloseTo(130)
  })

  it('rotated handles are drawn turned with the box', () => {
    const a = rectAt(editor, 100, 100, 100, 60)
    editor.store.update(a.id, { rot: 0.7 })
    editor.setSelection([a.id])
    const ctx = editor.overlay.getContext('2d')
    const calls = []
    const orig = ctx.rotate
    ctx.rotate = (r) => calls.push(r)
    editor.render()
    ctx.rotate = orig
    expect(calls.filter((r) => Math.abs(r - 0.7) < 1e-9).length).toBe(8)
  })
})

describe('links', () => {
  it('a press on a linked run or a link badge opens it; marks survive editing', () => {
    const opened = []
    const orig = window.open
    window.open = (u) => { opened.push(u); return null }
    try {
      editor.store.put({ id: 't', typeName: 'shape', type: 'text', x: 100, y: 100, rot: 0, z: 1, props: { text: 'go to the site now', color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1, marks: [{ from: 6, to: 14, href: 'https://site' }] } })
      editor.setTool('select')
      const lay = textLayout(editor.store.get('t'))
      const link = lineRuns('go to the site now', lay.lines[0], [{ from: 6, to: 14, href: 'https://site' }], lay.fontSize, lay.font).find((r) => r.st.href)
      // hover shows a pointer, a press follows the link without selecting
      editor._hoverCursor({ target: editor.canvas, clientX: 100 + link.x + 2, clientY: 100 + lay.lh / 2 })
      expect(editor.container.style.cursor).toBe('pointer')
      drag(editor, [[100 + link.x + 2, 100 + lay.lh / 2]])
      expect(opened).toEqual(['https://site'])
      expect(editor.selection.size).toBe(0)
      // a press on the plain part still selects
      drag(editor, [[102, 100 + lay.lh / 2]])
      expect([...editor.selection]).toEqual(['t'])
      // typing into the text keeps the link on its words
      editor.editShapeText('t')
      const ta = editor.editing.textarea
      ta.value = 'go to the site now!'
      ta.dispatchEvent(new Event('input'))
      ta.value = 'Go to the site now!'
      ta.dispatchEvent(new Event('input'))
      editor._commitText()
      expect(editor.store.get('t').props.marks).toEqual([{ from: 6, to: 14, href: 'https://site' }])
      // deleting the linked words drops the mark
      editor.editShapeText('t')
      editor.editing.textarea.value = 'Go now!'
      editor.editing.textarea.dispatchEvent(new Event('input'))
      editor._commitText()
      expect(editor.store.get('t').props.marks).toBeUndefined()
      // a shape-level link: its badge opens it
      editor.store.put({ id: 'g', typeName: 'shape', type: 'geo', x: 300, y: 300, rot: 0, z: 2, props: { geo: 'rectangle', w: 100, h: 60, color: 'black', size: 'm', dash: 'solid', fill: 'none', font: 'draw', url: 'https://box' } })
      drag(editor, [[300 + 100 - 12, 300 + 12]])
      expect(opened).toEqual(['https://site', 'https://box'])
      // unsafe schemes are ignored
      editor.store.update('g', { props: { url: 'javascript:alert(1)' } })
      drag(editor, [[300 + 100 - 12, 300 + 12]])
      expect(opened.length).toBe(2)
    } finally {
      window.open = orig
    }
  })
})

describe('tabs and fonts', () => {
  it('a tab pasted into the editor becomes spaces, caret kept; normalizeText does the same for pastes', async () => {
    const { normalizeText } = await import('../src/editor.js')
    expect(normalizeText('a\tb\r\nc')).toBe('a    b\nc')
    editor.store.put({ id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1, props: { text: 'ab', color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1 } })
    editor.setTool('select')
    editor.editShapeText('t')
    const ta = editor.editing.textarea
    ta.value = 'a\tb'
    ta.setSelectionRange(2, 2) // just after the tab
    ta.dispatchEvent(new Event('input'))
    expect(ta.value).toBe('a    b')
    expect(ta.selectionStart).toBe(5)
    editor._commitText()
    expect(editor.store.get('t').props.text).toBe('a    b')
  })

  it('the styles popover offers fonts and text alignment', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2 })
    const ed = board.editor
    ed.store.put({ id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1, props: { text: 'hi', color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1 } })
    ed.setSelection(['t'])
    c2.querySelector('.qd-dock button[data-name="styles"]').click()
    const fonts = [...c2.querySelectorAll('.qd-fonts .qd-opt')]
    expect(fonts.map((b) => b.title)).toEqual(['Hand-drawn', 'Sans', 'Serif', 'Mono'])
    expect(fonts[0].classList.contains('on')).toBe(true)
    fonts[2].click()
    expect(ed.store.get('t').props.font).toBe('serif')
    expect(fonts[2].classList.contains('on')).toBe(true)
    const aligns = [...c2.querySelectorAll('.qd-aligns .qd-opt')]
    expect(aligns.length).toBe(3)
    aligns[1].click()
    expect(ed.store.get('t').props.align).toBe('middle')
    expect(ed.currentStyles().align).toBe('middle')
    // with nothing selected the pen takes it, and new text is born with it
    ed.setSelection([])
    ed.setStyle('align', 'end')
    const id = ed.dropShape('text', { x: 50, y: 50 })
    expect(ed.store.get(id).props.align).toBe('end')
    board.destroy()
    c2.remove()
  })
})

describe('web fonts', () => {
  it('when the document fonts finish loading, text is re-measured and redrawn', async () => {
    const { textLayout } = await import('../src/shapes.js')
    editor.store.put({ id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1, props: { text: 'hi', color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1 } })
    const before = textLayout(editor.store.get('t'))
    expect(textLayout(editor.store.get('t'))).toBe(before) // cached
    editor._onFonts()
    expect(textLayout(editor.store.get('t'))).not.toBe(before) // measured afresh
  })
})

describe('minimap', () => {
  const mount = (opts = {}) => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    Object.defineProperty(c2, 'clientWidth', { value: 900, configurable: true })
    Object.defineProperty(c2, 'clientHeight', { value: 600, configurable: true })
    const board = createQuickdraw({ container: c2, ...opts })
    return { c2, board }
  }

  it('shows the whole drawing; a press on it puts the view there', () => {
    const { c2, board } = mount()
    const ed = board.editor
    const mm = c2.querySelector('.qd-minimap')
    expect(mm).toBeTruthy()
    expect(mm.style.display).toBe('')
    const canvas = mm.querySelector('.qd-minimap-canvas')
    ed.store.put({ id: 'far', typeName: 'shape', type: 'geo', x: 4000, y: 3000, rot: 0, z: 1, props: { geo: 'rectangle', w: 200, h: 200, color: 'black', size: 'm', dash: 'solid', fill: 'none', font: 'draw' } })
    // the map's transform covers the view and the far shape
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 180, height: 120 })
    const ev = (x, y, over = {}) => new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0, ...over })
    // press the far right-bottom of the map: the camera heads far into the page
    canvas.dispatchEvent(ev(170, 110))
    const centre = ed.screenToPage(450, 300)
    expect(centre.x).toBeGreaterThan(2000)
    expect(centre.y).toBeGreaterThan(1500)
    // its fit button brings the drawing into view (animated, so watch the call)
    const fit = vi.spyOn(ed, 'fitContent')
    mm.querySelector('.qd-minimap-fit').click()
    expect(fit).toHaveBeenCalledWith({ animate: 220 })
    // the button over its corner folds it
    mm.querySelector('.qd-minimap-toggle').click()
    expect(mm.classList.contains('qd-folded')).toBe(true)
    board.destroy()
    c2.remove()
  })

  it('a host can drop it, live; narrow boards go without', () => {
    const { c2, board } = mount({ minimap: false })
    const mm = c2.querySelector('.qd-minimap')
    expect(mm.style.display).toBe('none')
    board.ui.setOptions({ minimap: true })
    expect(mm.style.display).toBe('')
    Object.defineProperty(c2, 'clientWidth', { value: 400, configurable: true })
    board.ui.setOptions({ minimap: true })
    expect(mm.style.display).toBe('none')
    board.destroy()
    c2.remove()
  })
})

describe('action bar', () => {
  it("shows for touch by default (the stylesheet hides it under a mouse), or always / never on request", () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2 })
    const ui = c2.querySelector('.qd-ui')
    expect(ui.dataset.qdActions).toBe('touch')
    board.ui.setOptions({ actions: 'always' })
    expect(ui.dataset.qdActions).toBe('always')
    board.ui.setOptions({ actions: 'never' })
    expect(ui.dataset.qdActions).toBe('never')
    board.ui.setOptions({ actions: 'nonsense' })
    expect(ui.dataset.qdActions).toBe('touch')
    board.destroy()
    const b2 = createQuickdraw({ container: c2, actions: 'always' })
    expect(c2.querySelector('.qd-ui').dataset.qdActions).toBe('always')
    b2.destroy()
    c2.remove()
  })
})

describe('formatting while editing', () => {
  const key = (ta, k, over = {}) => ta.dispatchEvent(new KeyboardEvent('keydown', { key: k, metaKey: true, bubbles: true, cancelable: true, ...over }))
  const type = (ta, text) => { const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd); ta.setSelectionRange(s + text.length, s + text.length); ta.dispatchEvent(new Event('input')) }

  it('⌘B over a selection bolds it; with the caret alone it bolds what comes next, until the caret moves', () => {
    editor.store.put({ id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1, props: { text: 'hello world', color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1 } })
    editor.setTool('select')
    editor.editShapeText('t')
    const ta = editor.editing.textarea
    ta.setSelectionRange(0, 5)
    key(ta, 'b')
    expect(editor.store.get('t').props.marks).toEqual([{ from: 0, to: 5, b: true }])
    expect(editor.editingStyle().b).toBe(true)
    key(ta, 'b') // again: off
    expect(editor.store.get('t').props.marks).toBeUndefined()
    // caret at the end, ⌘I, then typing: the new text is italic, the old isn't
    ta.setSelectionRange(11, 11)
    key(ta, 'i')
    expect(editor.editingStyle().i).toBe(true)
    type(ta, '!')
    type(ta, '?')
    expect(editor.store.get('t').props.marks).toEqual([{ from: 11, to: 13, i: true }])
    // moving the caret forgets the pending toggle; typing there is plain
    ta.setSelectionRange(5, 5)
    ta.dispatchEvent(new Event('keyup'))
    key(ta, 'u')
    ta.setSelectionRange(0, 0)
    ta.dispatchEvent(new Event('keyup'))
    type(ta, 'X')
    expect(editor.store.get('t').props.marks).toEqual([{ from: 12, to: 14, i: true }])
    // strike and highlight take shift; code is ⌘E
    ta.setSelectionRange(1, 6)
    key(ta, 'x', { shiftKey: true })
    key(ta, 'h', { shiftKey: true })
    key(ta, 'e')
    expect(editor.store.get('t').props.marks[0]).toEqual({ from: 1, to: 6, s: true, hl: true, code: true })
    editor._commitText()
    expect(editor.store.get('t').props.text).toBe('Xhello world!?')
  })

  it('⌘K links the selection or the word at the caret; empty unlinks', () => {
    editor.store.put({ id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1, props: { text: 'see the docs now', color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1 } })
    editor.setTool('select')
    editor.editShapeText('t')
    const ta = editor.editing.textarea
    const orig = window.prompt
    try {
      window.prompt = () => 'https://docs'
      ta.setSelectionRange(9, 9) // inside "docs"
      key(ta, 'k')
      expect(editor.store.get('t').props.marks).toEqual([{ from: 8, to: 12, href: 'https://docs' }])
      expect(editor.editingStyle().href).toBe('https://docs')
      window.prompt = () => ''
      ta.setSelectionRange(8, 12)
      key(ta, 'k')
      expect(editor.store.get('t').props.marks).toBeUndefined()
      window.prompt = () => null // cancelled: nothing changes
      ta.setSelectionRange(0, 3)
      key(ta, 'k')
      expect(editor.store.get('t').props.marks).toBeUndefined()
    } finally {
      window.prompt = orig
    }
    editor._commitText()
  })

  it('the formatting bar appears while editing, mirrors the caret, and applies without losing the text', () => {
    const c2 = document.createElement('div')
    document.body.appendChild(c2)
    const board = createQuickdraw({ container: c2 })
    const ed = board.editor
    const bar = c2.querySelector('.qd-fmt')
    expect(bar.style.display).toBe('none')
    ed.store.put({ id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1, props: { text: 'abc', color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1, marks: [{ from: 0, to: 3, b: true }] } })
    ed.setTool('select')
    ed.editShapeText('t')
    expect(bar.style.display).toBe('')
    const btn = (k) => bar.querySelector(`[data-mark="${k}"]`)
    ed.editing.textarea.setSelectionRange(0, 3)
    ed.editing.textarea.dispatchEvent(new Event('select'))
    expect(btn('b').classList.contains('on')).toBe(true)
    btn('i').click()
    expect(ed.store.get('t').props.marks).toEqual([{ from: 0, to: 3, b: true, i: true }])
    expect(ed.editing).toBeTruthy() // still editing
    ed._commitText()
    expect(bar.style.display).toBe('none')
    board.destroy()
    c2.remove()
  })
})

describe('editing in place', () => {
  it('a rotated shape is edited at its angle: the surface turns about the shape centre', () => {
    editor.store.put({ id: 't', typeName: 'shape', type: 'text', x: 100, y: 100, rot: 0.5, z: 1, props: { text: 'tilted', color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1 } })
    editor.setTool('select')
    editor.editShapeText('t')
    const st = editor.editing.textarea.style
    expect(st.transform).toBe('rotate(0.5rad)')
    const lb = localBounds(editor.store.get('t'))
    expect(st.transformOrigin).toBe(`${lb.w / 2}px ${lb.h / 2}px`)
    editor._commitText()
    // a note's surface is inset by its padding, so the pivot is offset back to the note's centre
    editor.store.put({ id: 'n', typeName: 'shape', type: 'note', x: 0, y: 0, rot: 1, z: 2, props: { text: 'n', color: 'yellow', size: 'm', font: 'draw', scale: 1 } })
    editor.editShapeText('n')
    const ns = editor.editing.textarea.style
    expect(ns.transform).toBe('rotate(1rad)')
    expect(parseFloat(ns.transformOrigin)).toBeCloseTo(100 - 20) // centre x minus the 20px inset
    editor._commitText()
    // unrotated: no transform
    editor.store.put({ id: 'p', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 3, props: { text: 'flat', color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1 } })
    editor.editShapeText('p')
    expect(editor.editing.textarea.style.transform).toBe('')
    editor._commitText()
  })

  it('a formatting shortcut with the caret alone survives its own key-up', () => {
    editor.store.put({ id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1, props: { text: 'ab', color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1 } })
    editor.setTool('select')
    editor.editShapeText('t')
    const ta = editor.editing.textarea
    ta.setSelectionRange(2, 2) // moved without any event, as a click would
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', metaKey: true, bubbles: true, cancelable: true }))
    ta.dispatchEvent(new Event('keyup'))
    expect(editor.editingStyle().i).toBe(true)
    ta.value = 'abc'
    ta.setSelectionRange(3, 3)
    ta.dispatchEvent(new Event('input'))
    expect(editor.store.get('t').props.marks).toEqual([{ from: 2, to: 3, i: true }])
    editor._commitText()
  })
})

describe('double and triple click into text', () => {
  const put = (text) => editor.store.put({ id: 't', typeName: 'shape', type: 'text', x: 100, y: 100, rot: 0, z: 1, props: { text, color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1 } })

  it('a double-click selects the word under it; on whitespace it places the caret; Enter still selects all', async () => {
    const { textLayout, lineRuns } = await import('../src/shapes.js')
    put('alpha beta gamma')
    editor.setTool('select')
    const lay = textLayout(editor.store.get('t'))
    const runs = lineRuns('alpha beta gamma', lay.lines[0], undefined, lay.fontSize, lay.font)
    const cw = runs[0].w / 'alpha beta gamma'.length // the fake measurer is monospaced
    // into "beta": chars 6..10
    editor._dblClick({ clientX: 100 + cw * 7.5, clientY: 100 + lay.lh / 2 })
    let ta = editor.editing.textarea
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([6, 10])
    editor._commitText()
    // on the space after "alpha": a caret, nothing selected
    editor._dblClick({ clientX: 100 + cw * 5.4, clientY: 100 + lay.lh / 2 })
    ta = editor.editing.textarea
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([5, 5])
    editor._commitText()
    // Enter: everything
    editor.setSelection(['t'])
    press(editor, 'Enter')
    ta = editor.editing.textarea
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([0, 16])
    editor._commitText()
  })

  it('a third quick click on the same spot selects everything; a later click is just a click', () => {
    put('alpha beta gamma')
    editor.setTool('select')
    editor._dblClick({ clientX: 130, clientY: 110 })
    const ta = editor.editing.textarea
    expect(ta.selectionEnd - ta.selectionStart).toBeLessThan(16)
    const down = (x, y) => { const e = new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, cancelable: true }); ta.el.dispatchEvent(e); return e }
    const e1 = down(131, 111)
    expect(e1.defaultPrevented).toBe(true)
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([0, 16])
    // the window is spent: the next press is an ordinary caret placement
    const e2 = down(131, 111)
    expect(e2.defaultPrevented).toBe(false)
    editor._commitText()
  })
})

describe('page-wide zoom keys', () => {
  const key = (k, over = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, metaKey: true, bubbles: true, cancelable: true, ...over })
    ;(over.target || document.body).dispatchEvent(e)
    return e
  }

  it('⌘= / ⌘- / ⌘0 zoom the board from anywhere on the page, and never reach the browser', () => {
    // the zoom animates over frames, so watch the calls rather than the camera
    const spy = vi.spyOn(editor, 'zoomAt')
    expect(key('=').defaultPrevented).toBe(true)
    expect(spy).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 1.25, { animate: 140 })
    key('-')
    expect(spy).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 1 / 1.25, { animate: 140 })
    key('+')
    expect(spy).toHaveBeenLastCalledWith(expect.any(Number), expect.any(Number), 1.25, { animate: 140 })
    const reset = vi.spyOn(editor, 'resetZoom')
    key('0')
    expect(reset).toHaveBeenCalled()
    // plain keys and other combos are left alone
    expect(key('=', { metaKey: false }).defaultPrevented).toBe(false)
    expect(key('=', { altKey: true }).defaultPrevented).toBe(false)
  })

  it("a field that isn't the board's keeps its keys", () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const spy = vi.spyOn(editor, 'zoomAt')
    const e = key('=', { target: input })
    expect(e.defaultPrevented).toBe(false)
    expect(spy).not.toHaveBeenCalled()
    input.remove()
    // but the board's own text surface doesn't block them
    editor.store.put({ id: 't', typeName: 'shape', type: 'text', x: 0, y: 0, rot: 0, z: 1, props: { text: 'x', color: 'black', size: 'm', font: 'draw', autosize: true, scale: 1 } })
    editor.setTool('select')
    editor.editShapeText('t')
    const e2 = key('=', { target: editor.editing.textarea.el })
    expect(e2.defaultPrevented).toBe(true)
    expect(spy).toHaveBeenCalled()
    editor._commitText()
  })
})
