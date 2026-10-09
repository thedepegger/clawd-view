import { expect, test } from './kit'

import { GLOW_CYCLE, glowAt, titleShade } from '../hooks/clawd-view'

test('G1. the glow crosses the whole title, then rests', () => {
  const n = 22
  // Every letter is lit at some frame of a sweep
  for (let i = 0; i < n; i++) {
    const peak = Math.max(...Array.from({ length: GLOW_CYCLE }, (_, f) => glowAt(i, f, n)))
    expect(peak).toBeGreaterThan(0.2)
  }
  // Part of each cycle has no glow at all
  const dark = Array.from({ length: GLOW_CYCLE }, (_, f) => f).filter(f => [...Array(n).keys()].every(i => glowAt(i, f, n) === 0))
  expect(dark.length).toBeGreaterThan(0)
})

test('G2. the glow is soft: never full white, and the title stays a valid color', () => {
  for (let f = 0; f < GLOW_CYCLE * 2; f++) {
    for (let i = 0; i < 30; i++) {
      expect(glowAt(i, f, 30)).toBeLessThanOrEqual(0.55)
      expect(titleShade(i, f, 30)).toMatch(/^#[0-9a-f]{6}$/)
    }
  }
})
