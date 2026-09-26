// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { TextSurface } from '../src/textedit.js'

const mount = () => { const t = new TextSurface(); document.body.appendChild(t.el); return t }

describe('TextSurface', () => {
  it('renders text and marks as styled spans and reads them back', () => {
    const t = mount()
    t.render('bold link plain', [{ from: 0, to: 4, b: true }, { from: 5, to: 9, href: 'https://x', u: true }])
    const spans = [...t.el.querySelectorAll('span')]
    expect(spans.length).toBe(2)
    expect(spans[0].style.fontWeight).toBe('700')
    expect(spans[1].style.textDecoration).toContain('underline')
    expect(t.el.lastChild.tagName).toBe('BR') // the caret's landing pad
    expect(t.read()).toEqual({ text: 'bold link plain', marks: [{ from: 0, to: 4, b: true }, { from: 5, to: 9, href: 'https://x', u: true }] })
    expect(t.value).toBe('bold link plain')
    t.remove()
  })

  it('typing at the end of a bold run stays bold, even when the browser lands the characters outside the span', () => {
    const t = mount()
    t.render('hello', [{ from: 0, to: 5, b: true }], [5, 5])
    // the browser appends the typed text as a plain node after the span
    t.el.insertBefore(document.createTextNode(' world'), t.el.lastChild)
    t.el.dispatchEvent(new Event('input'))
    expect(t.value).toBe('hello world')
    expect(t.marks).toEqual([{ from: 0, to: 11, b: true }])
    // typing at the start of the run does not: it stays plain
    t.el.insertBefore(document.createTextNode('>> '), t.el.firstChild)
    t.el.dispatchEvent(new Event('input'))
    expect(t.marks).toEqual([{ from: 3, to: 14, b: true }])
    t.remove()
  })

  it('typing over a selected bold run leaves only the typed text bold: the run does not keep its old length', () => {
    const t = mount()
    t.render('Investigating a heading\n\nI tend to agree', [{ from: 0, to: 23, b: true }], [0, 23])
    // the browser replaces the span's text with the typed character
    const span = t.el.querySelector('span')
    span.textContent = 'I'
    t.el.dispatchEvent(new Event('input'))
    expect(t.value).toBe('I\n\nI tend to agree')
    expect(t.marks).toEqual([{ from: 0, to: 1, b: true }])
    // more typing inside the run grows it by exactly what was typed
    t.el.querySelector('span').textContent = 'Inv'
    t.el.dispatchEvent(new Event('input'))
    expect(t.marks).toEqual([{ from: 0, to: 3, b: true }])
    t.remove()
  })

  it("normalizes whatever the browser puts in: divs and brs become newlines, b/i/a tags become marks", () => {
    const t = mount()
    t.el.innerHTML = 'one<div>two <b>bold</b></div><br>three <a href="https://q">q</a><br>'
    const got = []
    t.el.addEventListener('qdinput', () => got.push(t.value))
    t.el.dispatchEvent(new Event('input'))
    expect(t.value).toBe('one\ntwo bold\nthree q')
    expect(t.marks).toEqual([{ from: 8, to: 12, b: true }, { from: 19, to: 20, href: 'https://q' }])
    expect(got).toEqual(['one\ntwo bold\nthree q'])
    // and the DOM is now our own again
    expect(t.el.querySelector('div')).toBe(null)
    t.remove()
  })

  it('Enter inserts a newline at the caret; undo and redo walk the edits', () => {
    const t = mount()
    t.render('ab', [{ from: 0, to: 2, b: true }])
    t.setSelectionRange(1, 1)
    t.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(t.value).toBe('a\nb')
    expect(t.marks).toEqual([{ from: 0, to: 3, b: true }]) // the newline inherits the run around it
    expect(t.selectionStart).toBe(2)
    t.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }))
    expect(t.value).toBe('ab')
    t.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    expect(t.value).toBe('a\nb')
    t.remove()
  })

  it('a paste lands as plain text at the selection', () => {
    const t = mount()
    t.render('hello world', [{ from: 6, to: 11, i: true }])
    t.setSelectionRange(0, 5)
    const ev = new Event('paste', { bubbles: true, cancelable: true })
    ev.clipboardData = { getData: (k) => (k === 'text/plain' ? 'HEY\r\nthere' : '<b>x</b>') }
    t.el.dispatchEvent(ev)
    expect(t.value).toBe('HEY\nthere world')
    expect(t.marks).toEqual([{ from: 10, to: 15, i: true }])
    t.remove()
  })

  it('setting value maps the marks like an edit would', () => {
    const t = mount()
    t.render('hello world', [{ from: 6, to: 11, i: true }])
    t.value = 'X hello world'
    expect(t.marks).toEqual([{ from: 8, to: 13, i: true }])
    t.remove()
  })
})
