import { expect, mock, test } from './kit'

// Fullscreen: the box moves into a side panel docked beside the transcript, and the band above the
// prompt keeps only what the others draw (Clawd). On the main screen nothing changes.

const PLAN = 'mcp__clawd-view__plan_steps'
const STATUS_LABELS = ['Model', '5-hour limit', 'Weekly limit', 'Context', 'Cost', 'Session', 'Cache', 'Input', 'Output', 'Messages']

const kids = (n: any): any[] => {
  const c = n?.children ?? n?.props?.children
  if (c === undefined || c === null) return []
  return (Array.isArray(c) ? c.flat(Infinity) : [c]).filter((x: any) => x !== null && x !== undefined && x !== false && x !== '')
}
const flat = (n: any): string =>
  n === null || n === undefined || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(flat).join('') : [n.props?.label ?? '', ...kids(n).map(flat)].join('')
const hasBorder = (n: any): boolean =>
  n !== null && typeof n === 'object' && (Boolean(n.props?.borderStyle) || kids(n).some(hasBorder))

/** The engine beneath: a clock, a store, a mascot stand-in, and a pane list the test controls. */
function world(on: any, canPlace = true) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('ui.toast', () => ({ value: undefined }))
  // Clawd stands in under the box
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['CLAWD'] }))
  const panes = new Map<string, { isPlaced: boolean; isShown: boolean }>()
  const opened: string[] = []
  on('ui.open', (_: unknown, e: any) => {
    opened.push(e.id)
    // Too narrow for an unasked panel: the engine keeps it open but unplaced
    panes.set(e.id, { isPlaced: canPlace, isShown: canPlace })
    return { value: canPlace ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } }
  })
  on('ui.close', (_: unknown, e: any) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...panes].map(([id, p]) => ({ id, title: id, isFocused: false, ...p })) }))
  return { panes, opened, clock }
}

async function bandAt($: any, isFullscreen: boolean, rows = 31, columns = 115) {
  const ui = await $.ui.mount({
    plugin: 'clawd-view', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: isFullscreen ? 10 : rows, bodyColumns: columns - 5, scroll: { offset: 0, bodyRows: 9 }, view: {} },
    viewport: { columns, rows, isFullscreen },
  } as never)
  const drawn = await ui.drawn()
  await ui.unmount()
  return drawn
}

async function panelAt($: any, bodyColumns: number, bodyRows: number) {
  const ui = await $.ui.mount({
    plugin: 'clawd-view', surface: 'terminal', component: 'Pane', requestId: 'clawd-view',
    props: { title: 'Clawd View', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} },
    viewport: { columns: 115, rows: 31, isFullscreen: true },
  } as never)
  const drawn = await ui.drawn()
  await ui.unmount()
  return drawn
}

async function startJob($: any) {
  await $.turn.start({ text: 'Build the pricing page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
}

test('P1. fullscreen: a new job opens the side panel; the main screen never does', async ($, on) => {
  const w = world(on)
  await bandAt($, false)
  await startJob($)
  expect(w.opened).toEqual([])

  await bandAt($, true)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await w.clock.advance(60_000)
  await $.turn.start({ text: 'Now add a blog page', turnId: 't2' } as never)
  expect(w.opened).toEqual(['clawd-view'])
})

test('P2. fullscreen with the panel showing: the band keeps only Clawd, no box', async ($, on) => {
  const w = world(on)
  await bandAt($, true)
  await startJob($)
  expect(w.panes.get('clawd-view')?.isShown).toBe(true)
  const t = flat(await bandAt($, true))
  expect(t).toContain('CLAWD')
  expect(t).not.toContain('Build the pricing section')
  expect(t).not.toContain('Clawd View')
})

test('P3. the main screen keeps the box above the prompt, with no panel button', async ($, on) => {
  world(on)
  await startJob($)
  const main = await bandAt($, false)
  expect(flat(main)).toContain('Build the pricing section')
  expect(hasBorder(main)).toBe(true)
  expect(flat(main)).not.toContain('Panel')
})

test('P4. the panel draws the bordered box with every step and all ten facts, one per line when narrow', async ($, on) => {
  world(on)
  await startJob($)
  const drawn = await panelAt($, 60, 40)
  const t = flat(drawn)
  expect(hasBorder(drawn)).toBe(true)
  expect(t).toContain('Build the pricing section')
  expect(t).toContain('Add the contact form')
  for (const label of STATUS_LABELS) expect(t).toContain(label)
  // Never the 2-line condensed form in the panel
  expect(t).not.toContain(' · cache ')
})

test('P5. turning Clawd View off closes the panel', async ($, on) => {
  const w = world(on)
  await bandAt($, true)
  await startJob($)
  expect(w.panes.has('clawd-view')).toBe(true)
  await $.command.run({ command: 'clawd-view', args: 'off' } as never)
  expect(w.panes.has('clawd-view')).toBe(false)
})

test('P6. fullscreen with no panel seated: the short band offers ▸ Panel, and /clawd-view panel opens it', async ($, on) => {
  const w = world(on, false)
  await startJob($)
  const t = flat(await bandAt($, true))
  expect(t).toContain('Panel')
  expect(t).toContain('Build the pricing section')
  const reply = await $.command.run({ command: 'clawd-view', args: 'panel' } as never)
  expect(JSON.stringify(reply)).toContain('panel opened')
  expect(w.opened).toContain('clawd-view')
})
