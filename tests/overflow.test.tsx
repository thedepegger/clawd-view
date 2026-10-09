import { expect, mock, test } from './kit'

import { ABOVE_IDLE_ROWS, ABOVE_WORK_ROWS, FRAME_MS, MENU_SPARE_ROWS, NEXT_STEPS_ROWS, PROMPT_ROWS, footerRows, pickTier } from '../hooks/clawd-view'

// The whole live area on the main screen must fit the terminal: rows pushed off its top cannot be
// erased and stay in the scrollback as a cut-off copy of the box. These tests count the rows the
// way the terminal lays them out, with their own counter (not the hook's).

const PLAN = 'mcp__clawd-view__plan_steps'
const PROGRESS = 'mcp__clawd-view__report_progress'
// What the others take on the main screen, outside the band: next-steps 6, prompt 5, spinner 2
// What sits outside the band on the main screen, measured live (2026-10-08): while Claude works
// the spinner and its 2-row tip above, the prompt and the footer below; between turns the
// "Cooked for…" line above, next-steps' list, the prompt and the footer
const OUTSIDE_WORK = ABOVE_WORK_ROWS + PROMPT_ROWS + footerRows(0)
const OUTSIDE_IDLE = ABOVE_IDLE_ROWS + NEXT_STEPS_ROWS + PROMPT_ROWS + footerRows(0)
const MASCOT_ROWS = 5

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

// The mascot is part of this mod, so the real mascot draws in the band and is counted with
// the box; beneath the plugins the engine draws nothing more
const withMascot = (on: any) => on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))

// Whether a drawing holds Clawd (the mascot's Client, keyed 'clawd')
const hasClawd = (n: any): boolean => n?.props?.key === 'clawd' || kids(n).some(hasClawd)

const SIZES: [number, number][] = [[24, 80], [28, 100], [31, 115], [40, 120], [50, 200]]
const names = ['Alpha step', 'Bravo step', 'Charlie step', 'Delta step', 'Echo step', 'Foxtrot step']

async function boxAt($: any, H: number, W: number, isFullscreen = false, isWorking = true) {
  const ui = await $.ui.mount({
    plugin: 'clawd-view', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking, maxRows: H, bodyColumns: W - 5, scroll: { offset: 0, bodyRows: H - 1 }, view: {} },
    viewport: { columns: W, rows: H, isFullscreen },
  } as never)
  const drawn = await ui.drawn()
  await ui.unmount()
  return drawn
}

async function setUp($: any, on: any) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  withMascot(on)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('classic.Notification', () => ({}))
  // The prompt box: what the edits typed, as the engine's $.prompt.read() reports it
  let draft = ''
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.edit', (_: unknown, e: any) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    draft = text
    return { text, cursor: e.start + e.inputText.length }
  })
  return clock
}

test('O1. the whole live area fits the terminal at every size, in every state', { timeoutMs: 20_000 }, async ($, on) => {
  await setUp($, on)
  const states: [string, () => Promise<unknown>][] = [
    ['working', async () => {
      await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
      await $.tool.call({ tool: PLAN, steps: names } as never)
    }],
    ['needs-you', () => $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' } as never)],
    ['stuck', () => $.turn.complete({ reason: 'error', answer: '', durationMs: 1000, isAborted: false, turnId: 't1', error: 'server_error' } as never)],
    ['done', async () => {
      await $.turn.start({ text: 'Again', turnId: 't2' } as never)
      await $.tool.call({ tool: PLAN, steps: names } as never)
      await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't2' } as never)
    }],
  ]
  for (const [state, enter] of states) {
    await enter()
    for (const [H, W] of SIZES) {
      // While Claude works (next-steps hidden) and between turns (next-steps' list under the band)
      for (const isWorking of [true, false]) {
        // With room left for the command menu's first frame, before the box shrinks for it
        const total = rows(await boxAt($, H, W, false, isWorking)) + (isWorking ? OUTSIDE_WORK : OUTSIDE_IDLE) + MENU_SPARE_ROWS
        if (total > H) throw new Error(`${state} ${isWorking ? 'working' : 'between turns'} at ${H}x${W}: ${total} rows > ${H}`)
        expect(total).toBeLessThanOrEqual(H)
      }
    }
  }
})

test('O2. a job keeps one box height from working to needs-you and stuck, and once done keeps every step with the figures under them as they fit', async ($, on) => {
  await setUp($, on)
  for (const [H, W] of [[31, 115], [40, 120], [24, 80]] as [number, number][]) {
    const heights: number[] = []
    await $.turn.start({ text: `Job at ${H}`, turnId: `w${H}` } as never)
    await $.tool.call({ tool: PLAN, steps: names.slice(0, 3) } as never)
    heights.push(rows(await boxAt($, H, W)))
    await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' } as never)
    heights.push(rows(await boxAt($, H, W)))
    await $.tool.call({ tool: 'Bash', command: 'false' } as never).catch(() => {})
    heights.push(rows(await boxAt($, H, W)))
    await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: `w${H}` } as never)
    const done = await boxAt($, H, W)
    expect(flat(done)).toContain('All done')
    expect(new Set(heights).size).toBe(1)
    for (const n of names.slice(0, 3)) expect(flat(done)).toContain(n)
    expect(rows(done)).toBeGreaterThanOrEqual(heights[0]!)
  }
})

test('O3. the tier follows the room alone', () => {
  expect(pickTier(16, true)).toBe('full')
  expect(pickTier(12, true)).toBe('full')
  expect(pickTier(11, true)).toBe('condensed')
  expect(pickTier(16, false)).toBe('condensed')
  expect(pickTier(8, true)).toBe('condensed')
  expect(pickTier(7, true)).toBe('compact')
  expect(pickTier(6, false)).toBe('compact')
  expect(pickTier(5, true)).toBe('line')
})

test('O4. the main screen box puts its steps first and the figures in the rows left, and is one line when tiny', async ($, on) => {
  await setUp($, on)
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: names.slice(0, 2) } as never)
  for (const [H, W] of [[24, 80], [31, 115], [40, 120], [50, 200]] as [number, number][]) {
    const box = await boxAt($, H, W)
    const t = flat(box)
    expect(t).toContain('Bravo step')
    expect(rows(box) + OUTSIDE_WORK).toBeLessThanOrEqual(H)
  }
  expect(flat(await boxAt($, 40, 120, true))).toContain('5-hour limit')
  // Very short: one line, no border, the active step named
  const tiny = await boxAt($, 12, 80)
  expect(flat(tiny)).toContain('Alpha step')
  expect(rows(tiny)).toBe(1)
})

test('O5. the animation runs at 4 frames a second at most', async ($, on) => {
  const clock = await setUp($, on)
  expect(FRAME_MS).toBeGreaterThanOrEqual(250)
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: names.slice(0, 2) } as never)
  const ui = await $.ui.mount({
    plugin: 'clawd-view', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 40, bodyColumns: 115, scroll: { offset: 0, bodyRows: 39 }, view: {} },
    viewport: { columns: 120, rows: 40, isFullscreen: false },
  } as never)
  let frames = 0
  let last = JSON.stringify(await ui.drawn())
  for (let i = 0; i < 40; i++) {
    await clock.advance(25)
    const now = JSON.stringify(await ui.drawn())
    if (now !== last) frames += 1
    last = now
  }
  await ui.unmount()
  // 1 second of clock: 4 frames, not 8
  expect(frames).toBeGreaterThan(0)
  expect(frames).toBeLessThanOrEqual(4)
})

test('O6. typing a slash command shrinks the box to one line and gives Clawd\'s rows back, and it comes back after', async ($, on) => {
  await setUp($, on)
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: names.slice(0, 3) } as never)
  const full = await boxAt($, 31, 115)
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: '/rel' } as never)
  const small = await boxAt($, 31, 115)
  // One line, no border, and no Clawd under it: the command menu takes about half the screen
  expect(rows(small)).toBe(1)
  expect(hasClawd(small)).toBe(false)
  expect(flat(small)).toContain('Step 1 of 3')
  // The step being worked on, never the rest of the list or the figures
  expect(flat(small)).toContain('Alpha step')
  expect(flat(small)).not.toContain('Bravo step')
  expect(flat(small)).not.toContain('Session')
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '/rel', cursor: 4, start: 0, end: 4, inputText: 'hello' } as never)
  expect(rows(await boxAt($, 31, 115))).toBe(rows(full))
})

// Like setUp, with probes: what the box looks like while the engine applies an edit or a submit
// (the engine's own frame), and what else takes rows in the band
function setUpProbe($: any, on: any, probe: { edit?: () => Promise<void>; submit?: () => Promise<void>; restRows?: number; draft?: string }) {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', (_: unknown, e: any) =>
    probe.restRows !== undefined
      ? { type: 'Box', props: { height: probe.restRows }, children: [] }
      : { type: 'Box', props: {}, children: [] })
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('classic.Notification', () => ({}))
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'sid-probe' }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.usage', () => ({ value: { startedAt: Date.parse('2026-10-08T07:00:00Z'), context: { window: 1_000_000 }, rateLimits: [] } }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', () => ({ value: { stdout: '{}', stderr: '', exitCode: 0 } }))
  // The prompt box as $.prompt.read() reports it: what the edits typed, emptied on submit
  on('prompt.read', () => ({ value: { text: probe.draft ?? '', cursor: (probe.draft ?? '').length } }))
  on('prompt.edit', async (_: unknown, e: any) => {
    if (probe.edit) await probe.edit()
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    probe.draft = text
    return { text, cursor: e.start + e.inputText.length }
  })
  on('prompt.submit', async (_: unknown, e: any) => {
    if (probe.submit) await probe.submit()
    probe.draft = ''
    return { text: e.text }
  })
}

test('O7. typing "/" shrinks the box before the engine draws the command menu', { timeoutMs: 20_000 }, async ($, on) => {
  let duringEdit = -1
  const probe: any = {}
  setUpProbe($, on, probe)
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: names.slice(0, 3) } as never)
  // The box is drawn from inside the engine's edit, but not awaited there: a test hook has 50 ms,
  // and waiting on a whole draw inside it overran that on a busy machine
  let drawing: Promise<number> | undefined
  probe.edit = async () => { drawing = boxAt($, 31, 115).then(rows) }
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: '/' } as never)
  duringEdit = await drawing!
  expect(duringEdit).toBe(1)
})

test('O8. sending a slash command (like /reload-plugins) and a reload both bring the box back whole', async ($, on) => {
  let duringSubmit = -1
  const probe: any = {}
  setUpProbe($, on, probe)
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: names.slice(0, 3) } as never)
  const full = rows(await boxAt($, 31, 115))
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: '/reload-plugins' } as never)
  expect(rows(await boxAt($, 31, 115))).toBe(1)
  // The command replaces the plugin inside next(e): the box must already be whole by then
  probe.submit = async () => { duringSubmit = rows(await boxAt($, 31, 115)) }
  await $.prompt.submit({ text: '/reload-plugins', wait: false, origin: { kind: 'composer' } } as never)
  expect(['submit', duringSubmit]).toEqual(['submit', full])
  // A reload with a '/' draft still stored starts whole
  probe.submit = undefined
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: '/' } as never)
  expect(rows(await boxAt($, 31, 115))).toBe(1)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as never)
  expect(['reload', rows(await boxAt($, 31, 115))]).toEqual(['reload', full])
})

test('O9. the box shows the steps that fit, the one being worked on among them, and once done keeps them', async ($, on) => {
  await setUp($, on)
  for (const [H, W] of [[31, 115], [24, 80], [40, 120], [50, 200]] as [number, number][]) {
    for (const n of [1, 2, 3, 6]) {
      await $.turn.start({ text: `Build the page ${H}-${n}`, turnId: `t${H}-${n}` } as never)
      await $.tool.call({ tool: PLAN, steps: names.slice(0, n) } as never)
      const working = await boxAt($, H, W)
      // The step being worked on is in the box, and the steps line counts them all
      expect(flat(working)).toContain('Alpha step')
      if (H >= 24) expect(flat(working)).toContain(`Step 1 of ${n}`)
      await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: `t${H}-${n}` } as never)
      const done = flat(await boxAt($, H, W, false, false))
      expect(done).toContain('All done')
      if (H >= 31) for (const name of names.slice(0, n)) expect(done).toContain(name)
    }
  }
})

test('O10. in fullscreen with no row left, the band is one line and never more than it has', async ($, on) => {
  setUpProbe($, on, { restRows: 5 })
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: names.slice(0, 3) } as never)
  const ui = await $.ui.mount({
    plugin: 'clawd-view', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 5, bodyColumns: 95, scroll: { offset: 0, bodyRows: 4 }, view: {} },
    viewport: { columns: 100, rows: 20, isFullscreen: true },
  } as never)
  const drawn = await ui.drawn()
  await ui.unmount()
  expect(rows(drawn)).toBeLessThanOrEqual(5)
})

test('O11. a slash flag left over from a sent command never keeps the box small once the draft is empty', async ($, on) => {
  const probe: any = {}
  setUpProbe($, on, probe)
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: names.slice(0, 3) } as never)
  const full = rows(await boxAt($, 31, 115))
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: '/rel' } as never)
  expect(rows(await boxAt($, 31, 115))).toBe(1)
  // The engine empties the box without an edit this plugin sees (a sent command, a reload)
  probe.draft = ''
  expect(rows(await boxAt($, 31, 115))).toBe(full)
})

test('O12. mid-job at 31x115 every step is in the box, step 4 with its Working label; the figures wait for room', async ($, on) => {
  await setUp($, on)
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: names } as never)
  for (const step of [1, 2, 3]) await $.tool.call({ tool: PROGRESS, step, percent: 100 } as never)
  const t = flat(await boxAt($, 31, 115))
  expect(t).toContain('Working')
  expect(t).toContain('Step 4 of 6')
  for (const n of names) expect(t).toContain(n)
  expect(t).not.toContain('Session')
})

test('O13. Clawd stays under the card while Claude works and between turns, and the whole live area still fits', async ($, on) => {
  await setUp($, on)
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: names.slice(0, 3) } as never)
  const working = await boxAt($, 31, 115, false, true)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  const idle = await boxAt($, 31, 115, false, false)
  expect(flat(idle)).toContain('All done')
  // The mascot stand-in (a 5-row box) is under the card both times
  expect(JSON.stringify(idle)).toContain(`"height":${MASCOT_ROWS}`)
  expect(JSON.stringify(working)).toContain(`"height":${MASCOT_ROWS}`)
  expect(rows(working) + OUTSIDE_WORK).toBeLessThanOrEqual(31)
  expect(rows(idle) + OUTSIDE_IDLE).toBeLessThanOrEqual(31)
})

test('O14. at 35x115 a finished job keeps every step with the full figures at the bottom of its box, and it all fits', async ($, on) => {
  await setUp($, on)
  for (const n of [3, 6]) {
    await $.turn.start({ text: `Build ${n}`, turnId: `f${n}` } as never)
    await $.tool.call({ tool: PLAN, steps: names.slice(0, n) } as never)
    await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: `f${n}` } as never)
    const box = await boxAt($, 35, 115, false, false)
    const t = flat(box)
    for (const name of names.slice(0, n)) expect(t).toContain(name)
    for (const label of ['Model', '5-hour limit', 'Weekly limit', 'Context', 'Cost', 'Session', 'Messages']) expect(t).toContain(label)
    expect(rows(box) + OUTSIDE_IDLE + MENU_SPARE_ROWS).toBeLessThanOrEqual(35)
  }
})

test('O15. while Claude works on a short plan at 35x115 the full figures sit under the steps, and it all fits', async ($, on) => {
  await setUp($, on)
  await $.turn.start({ text: 'Build the page', turnId: 'w1' } as never)
  await $.tool.call({ tool: PLAN, steps: names.slice(0, 3) } as never)
  const box = await boxAt($, 35, 115, false, true)
  const t = flat(box)
  for (const n of names.slice(0, 3)) expect(t).toContain(n)
  for (const label of ['Model', '5-hour limit', 'Weekly limit', 'Context', 'Cost', 'Session', 'Messages']) expect(t).toContain(label)
  expect(rows(box) + OUTSIDE_WORK + MENU_SPARE_ROWS).toBeLessThanOrEqual(35)
})

test('O16. Clawd, now part of this mod, draws under the box, and the whole live area still fits', async ($, on) => {
  await setUp($, on)
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: names.slice(0, 3) } as never)
  const band = await boxAt($, 40, 120)
  expect(hasClawd(band)).toBe(true)
  // The bordered box comes first, Clawd after it
  const card = kids(band)
  const at = card.findIndex(hasClawd)
  expect(at).toBeGreaterThan(0)
  expect(flat(card.slice(0, at))).toContain('Alpha step')
  expect(rows(band) + OUTSIDE_WORK).toBeLessThanOrEqual(40)
})
