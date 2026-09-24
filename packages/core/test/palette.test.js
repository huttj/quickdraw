import { describe, it, expect } from 'vitest'
import {
  THEMES, themeOf, COLOR_IDS, SIZE_IDS, DASH_IDS, FILL_IDS, GEO_IDS, GRID_IDS,
  SIZES, FONT_SIZES, FONTS,
} from '../src/palette.js'

describe('palette', () => {
  it('themeOf falls back to light for anything but dark', () => {
    expect(themeOf('dark').id).toBe('dark')
    expect(themeOf('light').id).toBe('light')
    expect(themeOf('nope').id).toBe('light')
    expect(themeOf(undefined).id).toBe('light')
  })

  it('both themes resolve every color id with stroke/fill/note', () => {
    for (const theme of Object.values(THEMES)) {
      for (const id of COLOR_IDS) {
        const c = theme.colors[id]
        expect(c, `${theme.id}/${id}`).toBeTruthy()
        for (const k of ['stroke', 'fill', 'note']) {
          expect(c[k]).toMatch(/^#[0-9a-f]{6}$/i)
        }
      }
    }
  })

  it('size/dash/fill/geo rosters are consistent with their maps', () => {
    for (const s of SIZE_IDS) {
      expect(SIZES[s]).toBeGreaterThan(0)
      expect(FONT_SIZES[s]).toBeGreaterThan(0)
    }
    expect(DASH_IDS).toContain('draw')
    expect(FILL_IDS).toContain('none')
    expect(GEO_IDS.length).toBeGreaterThanOrEqual(6)
    for (const f of Object.values(FONTS)) expect(typeof f).toBe('string')
  })

  it('every theme carries two-weight grid ink for rules and dots', () => {
    expect(GRID_IDS).toEqual(['none', 'lines', 'ruled', 'dots', 'crosses', 'iso'])
    const alpha = (c) => parseFloat(c.split(',').pop())
    for (const theme of Object.values(THEMES)) {
      for (const kind of ['line', 'dot']) {
        const g = theme.grid[kind]
        expect(g.minor, `${theme.id}/${kind}`).toMatch(/^rgba\(/)
        expect(g.major, `${theme.id}/${kind}`).toMatch(/^rgba\(/)
        expect(alpha(g.major)).toBeGreaterThan(alpha(g.minor))
      }
      // a dot lays down less ink than a rule, so it has to run darker
      expect(alpha(theme.grid.dot.minor)).toBeGreaterThan(alpha(theme.grid.line.minor))
    }
  })
})

describe('fonts', () => {
  it("the stacks lead with tldraw's faces, which fonts.css self-hosts", async () => {
    const { FONTS } = await import('../src/palette.js')
    const { readFileSync, existsSync } = await import('node:fs')
    const { resolve, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const here = dirname(fileURLToPath(import.meta.url))
    expect(FONTS.draw.startsWith("'Shantell Sans'")).toBe(true)
    expect(FONTS.sans.startsWith("'IBM Plex Sans'")).toBe(true)
    expect(FONTS.serif.startsWith("'IBM Plex Serif'")).toBe(true)
    expect(FONTS.mono.startsWith("'IBM Plex Mono'")).toBe(true)
    const css = readFileSync(resolve(here, '../src/fonts.css'), 'utf8')
    for (const fam of ['Shantell Sans', 'IBM Plex Sans', 'IBM Plex Serif', 'IBM Plex Mono']) {
      expect((css.match(new RegExp(`font-family: '${fam}'`, 'g')) || []).length).toBe(4) // regular, italic, bold, bold italic
    }
    // every file the stylesheet names is shipped, and so are the licences
    for (const m of css.matchAll(/url\('\.\.\/fonts\/([^']+)'\)/g)) expect(existsSync(resolve(here, '../fonts', m[1]))).toBe(true)
    expect(existsSync(resolve(here, '../fonts/LICENSE-ShantellSans.txt'))).toBe(true)
    expect(existsSync(resolve(here, '../fonts/LICENSE-IBMPlex.txt'))).toBe(true)
  })
})
