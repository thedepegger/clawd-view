import { expect, mock, test } from './kit'

import { ABOVE_WORK_ROWS, MENU_SPARE_ROWS, PROMPT_ROWS, footerRows, stepWindow, stepsText } from '../hooks/clawd-view'

// A plan longer than a short window holds: the box counts the steps it leaves out, in the rows it
// already has, and /clawd-view steps prints the whole list into the conversation

const PLAN = 'mcp__clawd-view__plan_steps'
const PROGRESS = 'mcp__clawd-view__report_progress'
const EIGHT = ['Read the notes', 'Find the slow page', 'Measure load times', 'Shrink the images', 'Cache the menu', 'Rewrite search', 'Run the checks', 'Write it up']

const kids = (n: any): any[] => {
  const c = n?.children ?? n?.props?.children
  if (c === undefined || c === null) return []
  return (Array.isArray(c) ? c.flat(Infinity) : [c]).filter((x: any) => x !== null && x !== undefined && x !== false && x !== '')
}
const rows = (n: any): number => {
  if (n === null || n === undefined || n === false) return 0
  if (typeof n === 'string' || typeof n === 'number') return 1
  if (Array.isArray(n)) return n.reduce((s: number, k: any) => s + rows(k), 0)
  const p = n.props ?? {}
  if (typeof p.height === 'number') return p.height
  if (n.type === 'Text' || n.type === 'Button') return 1
  const ch = kids(n)
  let inner = ch.length === 0 ? 0 : p.flexDirection === 'column' ? ch.reduce((s: number, k: any) => s + rows(k), 0) : Math.max(...ch.map(rows))
  inner += (p.marginTop ?? 0) + (p.marginBottom ?? 0) + 2 * (p.paddingY ?? 0)
  if (p.borderStyle) inner += 2
  return inner
}
const flat = (n: any): string =>
  n === null || n === undefined || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(flat).join('') : kids(n).map(flat).join('')

async function boxAt($: any, H: number, W: number) {
  const ui = await $.ui.mount({
    plugin: 'clawd-view', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: H, bodyColumns: W - 5, scroll: { offset: 0, bodyRows: H - 1 }, view: {} },
    viewport: { columns: W, rows: H, isFullscreen: false },
  } as never)
  const drawn = await ui.drawn()
  await ui.unmount()
  return drawn
}

test('L1. every step fits: no markers, the window is the whole plan', () => {
  expect(stepWindow(5, 2, 5)).toEqual({ start: 0, end: 5, above: 0, below: 0 })
  expect(stepWindow(5, 2, 9)).toEqual({ start: 0, end: 5, above: 0, below: 0 })
})

test('L2. the markers take a step row each, and the window plus markers never pass the room', () => {
  for (let room = 1; room <= 8; room++) {
    for (let anchor = 0; anchor <= 8; anchor++) {
      const w = stepWindow(8, anchor, room)
      const used = w.end - w.start + (w.above ? 1 : 0) + (w.below ? 1 : 0)
      expect(used).toBeLessThanOrEqual(Math.max(1, room))
      expect(w.end - w.start).toBeGreaterThanOrEqual(1)
      // The step at the anchor is always on screen
      const at = Math.min(anchor, 7)
      expect(at >= w.start && at < w.end).toBe(true)
      // A count, when shown, is exactly what is left out
      if (w.above) expect(w.above).toBe(w.start)
      if (w.below) expect(w.below).toBe(8 - w.end)
    }
  }
})

test('L3. four rows on step 5 of 8: done count, the step at work and the next, then what is left', () => {
  // "✓ 4 steps done", the step at work and the next one, "+ 2 more steps"
  expect(stepWindow(8, 4, 4)).toEqual({ start: 4, end: 6, above: 4, below: 2 })
  // Five rows: one finished step stays above the one at work
  expect(stepWindow(8, 4, 5)).toEqual({ start: 3, end: 6, above: 3, below: 2 })
  // Two rows: the step and the count still to come
  expect(stepWindow(8, 4, 2)).toEqual({ start: 4, end: 5, above: 0, below: 3 })
  // A finished plan shows its last steps under the done count
  expect(stepWindow(8, 8, 4)).toEqual({ start: 5, end: 8, above: 5, below: 0 })
})

test('L4. a short terminal with eight steps counts the hidden ones and still fits the screen', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-09T07:50:00Z') })
  mock.store(on)
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'Speed up the site', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: EIGHT } as never)
  for (let i = 1; i <= 4; i++) await $.tool.call({ tool: PROGRESS, step: i, percent: 100 } as never)
  let sawCounts = false
  for (const [H, W] of [[24, 80], [28, 100], [31, 115]] as [number, number][]) {
    const drawn = await boxAt($, H, W)
    const text = flat(drawn)
    expect(text).toContain('Cache the menu')
    const total = rows(drawn) + ABOVE_WORK_ROWS + PROMPT_ROWS + footerRows(0) + MENU_SPARE_ROWS
    expect(total).toBeLessThanOrEqual(H)
    // Whatever is left out is counted, never hidden silently
    const shown = EIGHT.filter(n => text.includes(n)).length
    if (shown < 8 && !text.includes('·')) {
      expect(/steps? done|more steps?|above/.test(text)).toBe(true)
      sawCounts = true
    }
  }
  expect(sawCounts).toBe(true)
})

test('L5. /clawd-view steps prints the whole checklist as plain text', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-09T07:50:00Z') })
  mock.store(on)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  const none: any = await $.command.run({ command: 'clawd-view', args: 'steps' } as never)
  expect(none.text).toContain('No checklist yet')
  await $.turn.start({ text: 'Speed up the site', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: EIGHT } as never)
  await $.tool.call({ tool: PROGRESS, step: 1, percent: 100 } as never)
  const ran: any = await $.command.run({ command: 'clawd-view', args: 'steps' } as never)
  for (const n of EIGHT) expect(ran.text).toContain(n)
  expect(ran.text).toContain('step 2 of 8')
  expect(ran.text).toContain('✓ Read the notes')
  expect(ran.text).toContain('● Find the slow page')
  expect(ran.text).toContain('○ Write it up')
})

test('L6. stepsText marks a finished plan done', () => {
  const text = stepsText({ title: 'Ship it', phase: 'done', tasks: [{ name: 'A', status: 'done', percent: 100 }, { name: 'B', status: 'done', percent: 100 }] })
  expect(text.split('\n')[0]).toBe('✓ Ship it · all 2 steps done')
})
