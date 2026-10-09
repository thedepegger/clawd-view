import { expect, mock, test } from './kit'

import { ABOVE_WORK_ROWS, MENU_SPARE_ROWS, PROMPT_ROWS, barSvg, footerRows, menuRows, svgPx } from '../hooks/clawd-view'

// Fixes to how the box draws, before the first public release: the desktop app's redraws, Svg
// sizes, the stats' width, label alignment, the slash command menu, the footer's agents, a
// hidden Clawd, fullscreen's long plans, the step window, the hint line and the guide

const PLAN = 'mcp__clawd-view__plan_steps'
const PROGRESS = 'mcp__clawd-view__report_progress'
const names = ['Alpha step', 'Bravo step', 'Charlie step', 'Delta step', 'Echo step', 'Foxtrot step']

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
  n === null || n === undefined || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(flat).join('') : [n.props?.label ?? '', ...kids(n).map(flat)].join('')
const hasClawd = (n: any): boolean => n?.props?.key === 'clawd' || kids(n).some(hasClawd)
const all = (n: any, pick: (x: any) => boolean): any[] => {
  const out: any[] = []
  const walk = (x: any) => {
    if (!x || typeof x !== 'object') return
    if (Array.isArray(x)) return x.forEach(walk)
    if (pick(x)) out.push(x)
    walk(x.children ?? x.props?.children)
  }
  walk(n)
  return out
}
const json = (n: unknown) => JSON.stringify(n)

/** The engine beneath the plugins: a clock, a store, a prompt box, and a count of band draws. */
function world(on: any, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on, store)
  mock.env(on, { LANG: 'en_US.UTF-8' })
  const w = { clock, bandDraws: 0, toasts: [] as string[], draft: '', agents: [] as any[] }
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', () => ({ value: { stdout: '+0000', stderr: '', exitCode: 0 } }))
  on('ui.toast', (_: unknown, e: any) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.focus', () => ({ value: undefined }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }))
  on('command.run', () => ({ text: '' }))
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))
  on('agent.list', () => ({ value: w.agents }))
  on('prompt.read', () => ({ value: { text: w.draft, cursor: w.draft.length } }))
  on('prompt.edit', (_: unknown, e: any) => {
    w.draft = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text: w.draft, cursor: w.draft.length }
  })
  on('ui.render', { component: 'AbovePrompt' }, () => {
    w.bandDraws += 1
    return { type: 'Box', props: {}, children: [] }
  })
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  return w
}

async function startSession($: any, surface: 'terminal' | 'desktop') {
  await $.session.start({ surface, isInteractive: true, cwd: '/work' })
}

async function startJob($: any, steps = names.slice(0, 2)) {
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps } as never)
}

const desktopBand = (bodyColumns = 110) => ({
  plugin: 'clawd-view', surface: 'desktop', component: 'AbovePrompt',
  viewport: { columns: bodyColumns + 10, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 30, bodyColumns, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}) as never

async function terminalBand($: any, H: number, W: number, isFullscreen = false, maxRows = H) {
  const ui = await $.ui.mount({
    plugin: 'clawd-view', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows, bodyColumns: W - 5, scroll: { offset: 0, bodyRows: maxRows - 1 }, view: {} },
    viewport: { columns: W, rows: H, isFullscreen },
  } as never)
  const drawn = await ui.drawn()
  await ui.unmount()
  return drawn
}

const OUTSIDE_WORK = (agents = 0) => ABOVE_WORK_ROWS + PROMPT_ROWS + footerRows(agents)

test('R1. desktop: a working job does not redraw the card each frame, and the toggle still answers after a while', async ($, on) => {
  // Clawd hidden, so only the card's own redraws count here (clawd.js redraws on its own clock)
  const w = world(on, { hidden: true })
  await startSession($, 'desktop')
  await startJob($)
  const ui = await $.ui.mount(desktopBand())
  expect(flat(await ui.drawn())).toContain('Step 1 of 2')
  const before = w.bandDraws
  for (let i = 0; i < 16; i++) await w.clock.advance(250)
  // 4 seconds: the terminal draws 16 frames, the desktop card at most one for the figures' clock
  expect(w.bandDraws - before).toBeLessThanOrEqual(2)
  // The title holds one color: one Text, not a Text a letter
  expect(all(await ui.drawn(), x => x.type === 'Text' && x.props?.bold && flat(x).length === 1)).toEqual([])
  await ui.press({ key: 'toggle' })
  expect(flat(await ui.drawn())).not.toContain('Step 1 of 2')
  expect(w.toasts.some(t => t.startsWith('Clawd View off'))).toBe(true)
  await ui.unmount()
})

test('R1d. desktop: the card and Clawd together redraw only now and then while Claude works', async ($, on) => {
  // Both halves of the band on: the checklist and Clawd in his scene
  const w = world(on, { hidden: false })
  await startSession($, 'desktop')
  await startJob($)
  const ui = await $.ui.mount(desktopBand())
  await w.clock.advance(250)
  const before = w.bandDraws
  for (let i = 0; i < 24; i++) await w.clock.advance(250)
  // 6 seconds: the terminal draws about 40 frames; the desktop a handful at most
  expect(w.bandDraws - before).toBeLessThanOrEqual(4)
  await ui.press({ key: 'toggle' })
  expect(w.toasts.some(t => t.startsWith('Clawd View off'))).toBe(true)
  await ui.unmount()
})

test('R1b. the terminal keeps its frame clock: the card redraws 4 times a second', async ($, on) => {
  const w = world(on, { hidden: true })
  await startSession($, 'terminal')
  await startJob($)
  const ui = await $.ui.mount({
    plugin: 'clawd-view', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 40, bodyColumns: 115, scroll: { offset: 0, bodyRows: 39 }, view: {} },
    viewport: { columns: 120, rows: 40, isFullscreen: false },
  } as never)
  const before = w.bandDraws
  for (let i = 0; i < 8; i++) await w.clock.advance(250)
  expect(w.bandDraws - before).toBeGreaterThanOrEqual(6)
  await ui.unmount()
})

test('R1c. the desktop wave loops seamlessly: 24 cells of wave, 2 cells every 250 ms, in the terminal\'s colors', () => {
  const colors = Array<string>(16).fill('#000000')
  const svg = barSvg(colors, true)
  // 12 steps of 16 pixels over 3 seconds: the 13th would be 192 pixels, one whole wave
  const values = svg.match(/values="([^"]*)"/)![1]!.split(';')
  expect(values.length).toBe(12)
  expect(values[11]).toBe('176 0')
  expect(svg).toContain('dur="3s"')
  // The wave's shades, light to deep, all drawn
  expect(svg).toContain('#ef9a81')
  expect(svg).toContain('#e35126')
  // Drawn from one wave to the left of the bar, so the slide never shows a gap
  expect(svg).toContain('x="-192"')
})

test('R2. desktop: a card too narrow for bars draws no Svg 0 pixels wide, and every Svg is 1 to 4096 pixels', async ($, on) => {
  world(on, { hidden: true })
  await startSession($, 'desktop')
  await startJob($)
  for (const bodyColumns of [24, 30, 40, 110]) {
    const ui = await $.ui.mount(desktopBand(bodyColumns))
    const drawn = await ui.drawn()
    expect(flat(drawn)).toContain('Alpha')
    for (const s of all(drawn, x => x.type === 'Svg')) {
      expect(s.props.width).toBeGreaterThanOrEqual(1)
      expect(s.props.width).toBeLessThanOrEqual(4096)
      expect(s.props.height).toBeGreaterThanOrEqual(1)
      expect(s.props.height).toBeLessThanOrEqual(4096)
      expect(String(s.props.alt).length).toBeGreaterThan(0)
    }
    await ui.unmount()
  }
  expect(svgPx(0)).toBe(1)
  expect(svgPx(100_000)).toBe(4096)
  expect(barSvg([])).toContain('width="1"')
})

test('R3. desktop: /clawd-stats in a narrow window stacks the figures instead of a block wider than its border', async ($, on) => {
  world(on, { hidden: true })
  await startSession($, 'desktop')
  const ran: any = await $.command.run({ command: 'clawd-stats', args: '' } as never)
  for (const [columns, isSide] of [[90, false], [140, true]] as [number, boolean][]) {
    const ui = await $.ui.mount({
      plugin: 'clawd-view', surface: 'desktop', component: 'CommandOutput',
      props: { command: 'clawd-stats', args: '', text: ran.text, isErrored: false },
      viewport: { columns, rows: 40 },
    } as never)
    const drawn = await ui.drawn()
    const t = json(drawn)
    for (const label of ['Session', 'Cache', 'Input', 'Output', 'Messages']) expect(t).toContain(label)
    expect(t.includes('"width":28,"flexShrink":0,"marginLeft":2')).toBe(isSide)
    // No box inside wider than the border's inside
    const outer = all(drawn, x => x.props?.borderStyle)[0]
    for (const b of all(drawn, x => x.type === 'Box' && typeof x.props?.width === 'number' && x !== outer)) expect(b.props.width).toBeLessThanOrEqual(outer.props.width - 4)
    await ui.unmount()
  }
})

test('R4. the percent on the steps line starts where every row\'s Done, Working and Next do', async ($, on) => {
  world(on, { hidden: true })
  await startSession($, 'desktop')
  await startJob($, names.slice(0, 3))
  await $.tool.call({ tool: PROGRESS, step: 1, percent: 100 } as never)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...(desktopBand() as any), surface })
    const drawn = await ui.drawn()
    // Each line: the cells before its last word (fixed-width columns), and that word's margin
    const starts = all(drawn, x => x.props?.flexDirection === 'row' && /^(Step 2 of 3|.*step)/.test(flat(x)) && kids(x).length >= 2 && kids(x).at(-1)?.props?.marginLeft === 2)
      .map(x => kids(x).slice(0, -1).reduce((s: number, k: any) => s + (k.props?.width ?? NaN), 0) + 2)
    // The steps line and the three step rows
    expect(starts.length).toBe(4)
    expect(new Set(starts).size).toBe(1)
    expect(Number.isFinite(starts[0])).toBe(true)
    await ui.unmount()
  }
})

test('R5. desktop: typing "/" keeps the whole card (the app has no command menu under the prompt)', async ($, on) => {
  world(on, { hidden: true })
  await startSession($, 'desktop')
  await startJob($, names.slice(0, 3))
  const full = rows(await (await $.ui.mount(desktopBand())).drawn())
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: '/rel' } as never)
  const typing = await $.ui.mount(desktopBand())
  const t = flat(await typing.drawn())
  for (const n of names.slice(0, 3)) expect(t).toContain(n)
  expect(t).toContain('Session')
  expect(rows(await typing.drawn())).toBe(full)
})

test('R6. desktop: with the side panel showing, the band keeps only what the others draw', async ($, on) => {
  world(on, { hidden: true })
  const panes = new Map<string, { isPlaced: boolean; isShown: boolean }>()
  on('ui.open', (_: unknown, e: any) => {
    panes.set(e.id, { isPlaced: true, isShown: true })
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [...panes].map(([id, p]) => ({ id, title: id, isFocused: false, ...p })) }))
  await startSession($, 'desktop')
  await startJob($)
  expect(flat(await (await $.ui.mount(desktopBand())).drawn())).toContain('Alpha step')
  await $.command.run({ command: 'clawd-view', args: 'panel' } as never)
  const band = flat(await (await $.ui.mount(desktopBand())).drawn())
  expect(band).not.toContain('Alpha step')
  expect(band).not.toContain('Clawd View')
})

test('R7. the panel\'s "can\'t open" toast speaks to the surface: fullscreen in the terminal, not on the desktop', async ($, on) => {
  const w = world(on, { hidden: true })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no surface places panes' } }))
  on('ui.panes', () => ({ value: [] }))
  await startSession($, 'desktop')
  await startJob($)
  await (await $.ui.mount(desktopBand())).drawn()
  await $.command.run({ command: 'clawd-view', args: 'panel' } as never)
  const desk = w.toasts.find(t => t.includes('panel'))
  expect(desk).toBeDefined()
  expect(desk).not.toContain('/tui fullscreen')
  w.toasts.length = 0
  await terminalBand($, 31, 115)
  await $.command.run({ command: 'clawd-view', args: 'panel' } as never)
  expect(w.toasts.find(t => t.includes('panel'))).toContain('/tui fullscreen')
})

test('R8. terminal: typing "/" draws one line and gives Clawd\'s rows back, so the half-screen command menu fits', async ($, on) => {
  world(on)
  await startSession($, 'terminal')
  await startJob($, names)
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: '/' } as never)
  for (const [H, W] of [[24, 80], [26, 100], [28, 100], [31, 115], [40, 120], [50, 200]] as [number, number][]) {
    const band = await terminalBand($, H, W)
    expect(rows(band)).toBe(1)
    expect(hasClawd(band)).toBe(false)
    expect(flat(band)).toContain('Alpha step')
    expect(rows(band) + OUTSIDE_WORK() + menuRows(H)).toBeLessThanOrEqual(H)
  }
  expect(menuRows(31)).toBe(16)
  // Fullscreen keeps Clawd beside the line: the slot is the band's own
  expect(rows(await terminalBand($, 40, 120, true, 12))).toBeLessThanOrEqual(12)
})

test('R9. background agents listed in the footer take their rows from the box', async ($, on) => {
  const w = world(on)
  await startSession($, 'terminal')
  await startJob($, names.slice(0, 3))
  const free = await terminalBand($, 35, 115)
  expect(flat(free)).toContain('Session')
  w.agents = [1, 2, 3].map(i => ({ id: `a${i}`, description: 'Look around', type: 'Explore', status: 'running' }))
  const busy = await terminalBand($, 35, 115)
  expect(flat(busy)).toContain('Charlie step')
  expect(rows(busy) + OUTSIDE_WORK(3) + MENU_SPARE_ROWS).toBeLessThanOrEqual(35)
  expect(rows(busy)).toBeLessThan(rows(free))
  // A finished agent leaves the footer; the news line under the steps keeps its one row
  w.agents = w.agents.map(a => ({ ...a, status: 'completed' }))
  const after = await terminalBand($, 35, 115)
  expect(flat(after)).toContain('finished')
  expect(rows(after)).toBe(rows(free) + 1)
})

test('R10. /clawd hidden gives the box Clawd\'s rows back', async ($, on) => {
  world(on)
  await startSession($, 'terminal')
  await startJob($, names)
  const shown = await terminalBand($, 35, 115)
  expect(hasClawd(shown)).toBe(true)
  expect(flat(shown)).not.toContain('Session')
  await $.command.run({ command: 'clawd', args: 'hidden' } as never)
  const hidden = await terminalBand($, 35, 115)
  expect(hasClawd(hidden)).toBe(false)
  // The 5 rows Clawd had now hold the figures under all six steps
  for (const n of names) expect(flat(hidden)).toContain(n)
  expect(flat(hidden)).toContain('Session')
  expect(rows(hidden) + OUTSIDE_WORK() + MENU_SPARE_ROWS).toBeLessThanOrEqual(35)
})

test('R11. fullscreen: a long plan windows its steps to the slot instead of overflowing it', async ($, on) => {
  world(on)
  await startSession($, 'terminal')
  await startJob($, [...names, 'Golf step', 'Hotel step'])
  for (const step of [1, 2, 3, 4]) await $.tool.call({ tool: PROGRESS, step, percent: 100 } as never)
  for (const maxRows of [10, 12, 14, 16, 20]) {
    const band = await terminalBand($, 40, 145, true, maxRows)
    expect(rows(band)).toBeLessThanOrEqual(maxRows)
    expect(flat(band)).toContain('Echo step')
  }
  // With room for every step and the figures, all of them
  const tall = flat(await terminalBand($, 60, 145, true, 30))
  for (const n of [...names, 'Golf step', 'Hotel step']) expect(tall).toContain(n)
  expect(tall).toContain('Session')
})

test('R12. the step window follows the step being worked on, not the first one left undone', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
  await startSession($, 'terminal')
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: names.map((content, i) => ({ content, activeForm: content, status: i === 0 ? 'completed' : i === 4 ? 'in_progress' : 'pending' })),
  } as never)
  const t = flat(await terminalBand($, 28, 100))
  expect(t).toContain('Echo step')
  expect(t).toContain('Working')
  expect(t).not.toContain('Bravo step')
})

test('R13. the hint line\'s tail is "Clawd View", no separator of its own (the engine adds one)', async ($, on) => {
  let tail: unknown
  on('ui.render', { component: 'PromptHint' }, (_: unknown, e: any) => {
    tail = e.props.tail
    return { type: 'Text', props: {}, children: [e.props.hint] }
  })
  world(on)
  await startSession($, 'terminal')
  const ui = await $.ui.mount({
    plugin: 'clawd-view', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    viewport: { columns: 120, rows: 40, isFullscreen: false },
  } as never)
  await ui.drawn()
  expect(tail).toBe('Clawd View')
})

test('R14. /clawd-view help: the window sizes as the README has them, 106 wide, the desktop and the panel', async ($, on) => {
  world(on)
  await startSession($, 'terminal')
  const ran: any = await $.command.run({ command: 'clawd-view', args: 'help' } as never)
  for (const part of ['Under 106 wide', '106 wide', '35 lines tall', 'no stats for longer plans', 'desktop app', '/clawd-view panel', '/clawd-stats']) expect(ran.text).toContain(part)
  expect(ran.text).not.toContain('105')
  expect(ran.text).not.toContain('2-line')
  expect(ran.text).not.toContain('short stats')
})
