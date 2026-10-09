import { expect, mock, test } from './kit'

import { cellWidth, cleanName, countRows, fitCells, isAnimated, isNotTyped, pickLimits, shortCount } from '../hooks/clawd-view'

const PLAN = 'mcp__clawd-view__plan_steps'
const PROGRESS = 'mcp__clawd-view__report_progress'

const band = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 40,
    // A wide terminal, so the full info block has its two columns (80 columns gets the condensed one)
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 39 },
    view: {},
  },
}
// The figures show in the fullscreen box (and /clawd-stats); the main screen's box leaves them out
const fullBand = { ...band, viewport: { columns: 145, rows: 40, isFullscreen: true } }

const engineBand = () => ({ type: 'Box' as const, props: {}, children: [] })


test('1. names are cleaned to plain English', () => {
  expect(cleanName('Build the pricing section in `src/Pricing.tsx`')).toBe('Build the pricing section in')
  expect(cleanName('Update src/app/page.tsx and the header')).toBe('Update and the header')
  const long = cleanName('Rewrite the onboarding flow so new members can find the pricing table and contact form')
  expect(long.length).toBeLessThanOrEqual(40)
  expect(long.endsWith('…')).toBe(true)
  expect(cleanName('`npm run build`')).toBe('Working on it')
})

test('2. a to-do list plus a 60% report draws Done, 60%, Next and Up next', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Read your brand notes', status: 'completed', activeForm: 'Reading your brand notes' },
      { content: 'Build the pricing section', status: 'in_progress', activeForm: 'Building the pricing section' },
      { content: 'Add the contact form', status: 'pending', activeForm: 'Adding the contact form' },
      { content: 'Polish the footer', status: 'pending', activeForm: 'Polishing the footer' },
    ],
  })
  await $.tool.call({ tool: PROGRESS, task: 'Build the pricing section', percent: 60 } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'clawd-view', surface, ...band })
    expect(await ui.find({ type: 'Text', text: /Done/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /60%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Add the contact form/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s*Next$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Polish the footer/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s*Up next$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Step 2 of 4\s*$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^40%$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('3. a permission prompt shows Needs you', async ($, on) => {
  on('classic.Notification', () => ({}))
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })

  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Claude needs your OK to continue/ })).toBeDefined()
  await ui.unmount()
})

test('4. /clawd-view off hides the card and leaves only the button', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  await $.command.run({ command: 'clawd-view', args: 'off' } as never)

  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  expect(await ui.find({ type: 'Text', text: /Build the pricing section/ })).toBeUndefined()
  expect(await ui.find({ key: 'toggle' })).toBeDefined()
  await ui.unmount()

})

test('5. report_progress at 100 checks off step one and starts step two', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  const planned = await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form', 'Polish the footer'] } as never)
  expect(planned.result).toBe('Planned 3 steps. The first one has started.')
  const noted = await $.tool.call({ tool: PROGRESS, task: 'Build the pricing section', percent: 100 } as never)
  expect(noted.result).toBe('Progress noted: 100%.')

  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  expect(await ui.find({ type: 'Text', text: /Build the pricing section/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^● $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Step 2 of 3\s*$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Working/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Polish the footer/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s*Next$/ })).toBeDefined()
  await ui.unmount()
})

test('6. tools are denied before a plan exists and allowed after', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  // The gate is armed by a request the person typed
  await $.turn.start({ text: 'What does this project do?', turnId: 't1' } as never)

  const before = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(before.isError === true || before.deny !== undefined).toBe(true)

  await $.tool.call({ tool: PLAN, steps: ['Look around the project', 'Answer your question'] } as never)
  const after = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(after.deny).toBeUndefined()
  expect(after.isError).toBeUndefined()
})

test('7. the button at the top-right of the card turns Clawd View off and back on', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'clawd-view', surface, ...band })
    expect(await ui.find({ key: 'toggle' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Step 1 of 2\s*$/ })).toBeDefined()

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /^Step 1 of 2\s*$/ })).toBeUndefined()
    expect(await ui.find({ key: 'toggle' })).toBeDefined()

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /^Step 1 of 2\s*$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('8. the card leaves Clawd to clawd.js, even in a wide terminal', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)

  const wide = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  expect(await wide.find({ key: 'buddy' })).toBeUndefined()
  expect(await wide.find({ type: 'Text', text: /Build the pricing section/ })).toBeDefined()
  await wide.unmount()

  const narrow = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band, props: { ...band.props, bodyColumns: 40 } })
  expect(await narrow.find({ key: 'buddy' })).toBeUndefined()
  await narrow.unmount()
})

const statusMeasure = {
  context: { tokens: 530_000, window: 1_000_000, percent: 53 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 86, resetsAt: '2026-10-08T10:00:00Z' },
    { kind: 'seven_day', percentUsed: 18, resetsAt: '2026-10-10T03:00:00Z' },
  ],
  changed: ['context', 'rateLimits'],
}
const flat = (n: any): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n)
    : Array.isArray(n) ? n.map(flat).join('')
    : n && typeof n === 'object' ? flat(n.children ?? n.props?.children) : ''

test('9. the status line is the box\'s last line and only shows with it', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', engineBand)
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))
  await $.session.measure(statusMeasure as never)

  // No checklist yet: no box, so no status row
  const before = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...fullBand })
  expect(flat(await before.drawn())).not.toContain('5-hour limit')
  await before.unmount()

  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...fullBand })
  const t = flat(await ui.drawn())
  await ui.unmount()
  expect(t).toContain('5-hour limit')
  expect(t).toContain('86%')
  expect(t).toContain('Weekly limit')
  expect(t).toContain('Context')
  // The right-hand column: this session, one fact per line
  for (const label of ['Session', 'Cache', 'Input', 'Output', 'Messages']) expect(t).toContain(label)
  expect(t.indexOf('Session')).toBeLessThan(t.indexOf('Messages'))
  // The info block comes after the steps, one fact per line in this order
  expect(t.indexOf('5-hour limit')).toBeGreaterThan(t.indexOf('Add the contact form'))
  expect(t.indexOf('Weekly limit')).toBeGreaterThan(t.indexOf('5-hour limit'))
  expect(t.indexOf('Context')).toBeGreaterThan(t.indexOf('Weekly limit'))

  // /clawd-status off hides the row; the box stays
  await $.command.run({ command: 'clawd-status', args: 'off' } as never)
  const off = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...fullBand })
  const t2 = flat(await off.drawn())
  await off.unmount()
  expect(t2).not.toContain('5-hour limit')
  expect(t2).toContain('Build the pricing section')
})

test('10. report_progress with only a step number ticks that step, never adds one', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  await $.tool.call({ tool: PROGRESS, step: 1, percent: 100 } as never)
  await $.tool.call({ tool: PROGRESS, percent: 40 } as never)

  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  expect(t).not.toContain('Working on it')
  expect(t).toContain('Step 2 of 2')
  expect(t).toContain('40%')
})

test('11. a turn that ends with a step not ticked off shows All done and stops moving', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  await $.tool.call({ tool: PROGRESS, task: 'Build the pricing section', percent: 100 } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)

  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  expect(t).toContain('All done')
  expect(t).not.toContain('Working')
  expect(t).not.toContain('Needs you')
})

test('12. a turn started by a background notice keeps the job', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  await $.turn.start({ text: '<task-notification>agent finished</task-notification>', turnId: 't2' } as never)

  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  expect(t).toContain('Build the pricing section')
  expect(t).not.toContain('Understand your request')
})

test('13. stuck mid-turn keeps moving; a finished or folded card stands still', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: null, text: 'command failed' }) as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'false' })

  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  expect(flat(await ui.drawn())).toContain('Stuck')
  // A quarter second is two frames: the bar's wave moves, so the drawing changes
  const first = JSON.stringify(await ui.drawn())
  await clock.advance(250)
  const later = JSON.stringify(await ui.drawn())
  await ui.unmount()
  expect(later).not.toBe(first)

  const base = { title: 'x', tasks: [], needsYouReason: null, stuckReason: null, startedAt: 0, isCollapsed: false }
  expect(isAnimated({ ...base, phase: 'stuck', finishedAt: null })).toBe(true)
  expect(isAnimated({ ...base, phase: 'stuck', finishedAt: 5 })).toBe(false)
  expect(isAnimated({ ...base, phase: 'stopped', finishedAt: 5 })).toBe(false)
  expect(isAnimated({ ...base, phase: 'done', finishedAt: 5, isCollapsed: true })).toBe(false)
  // A done card is drawn in its final form from its first frame, so it never moves
  expect(isAnimated({ ...base, phase: 'done', finishedAt: 5 })).toBe(false)
})

test('14. with no readings yet the info block has no placeholders: Cost $0.00, cache starts on reply', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...fullBand })
  const t = flat(await ui.drawn())
  await ui.unmount()
  const block = t.slice(t.indexOf('Model'))
  expect(block).toContain('Cost')
  expect(block).toContain('$0.00')
  expect(block).toContain('starts on reply')
  expect(block).toContain('after first reply')
  expect(block).not.toContain('--')
})

test('15. a saved limit reading shows until its window passes, then waits for the next reply', () => {
  const at = Date.parse('2026-10-08T07:50:00Z')
  const older = { source: 'usage' as const, at: at - 3_600_000, limits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: '2026-10-08T09:00:00Z' }] }
  const newer = { source: 'saved' as const, at: at - 60_000, limits: [
    { kind: 'five_hour', percentUsed: 40, resetsAt: '2026-10-08T09:00:00Z' },
    { kind: 'seven_day', percentUsed: 70, resetsAt: '2026-10-08T07:00:00Z' },
  ] }
  const views = pickLimits([older, newer], at)
  expect(views.find(v => v.kind === 'five_hour')?.percentUsed).toBe(40)
  const week = views.find(v => v.kind === 'seven_day')
  // Its new window already holds whatever was used since, so no made-up 0%
  expect(week?.percentUsed).toBe(undefined)
  expect(week?.isFresh).toBe(true)
  expect(pickLimits([], at)).toEqual([])
})

// The condensed info block's lines: the Texts inside the Box keyed status-row
const statusLines = (n: any): any[] => {
  if (!n || typeof n !== 'object') return []
  if ((n.key ?? n.props?.key) === 'status-row') {
    const kids = n.children ?? n.props?.children
    return (Array.isArray(kids) ? kids : [kids]).filter((k: any) => k && k.type === 'Text')
  }
  const kids = Array.isArray(n) ? n : (n.children ?? n.props?.children)
  for (const k of Array.isArray(kids) ? kids : kids ? [kids] : []) {
    const found = statusLines(k)
    if (found.length) return found
  }
  return []
}

// The info block's rows: the deepest Box whose children hold every label, one child per line
const infoRows = (n: any): any[] | null => {
  if (!n || typeof n !== 'object') return null
  const kids = Array.isArray(n) ? n : (n.children ?? n.props?.children)
  const list = Array.isArray(kids) ? kids : kids ? [kids] : []
  for (const k of list) {
    const deeper = infoRows(k)
    if (deeper) return deeper
  }
  const t = flat(n)
  return !Array.isArray(n) && list.length >= 5 && t.startsWith('Model') && t.includes('Messages') ? list : null
}

test('16. a done card keeps its steps, with the figures at its bottom when they fit, and the fold later changes nothing', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)

  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  // A button's press handle is new on every draw; the screen is everything else
  const shown = async () => JSON.stringify(await ui.drawn()).replace(/"handle":\d+/g, '')
  const before = await shown()
  // The fold fires 5 seconds after done and changes nothing on screen
  await clock.advance(6000)
  const after = await shown()
  await ui.unmount()
  expect(before).toContain('2 of 2 steps done')
  expect(before).toContain('5-hour limit')
  expect(after).toBe(before)
})

test('17. an 80-column terminal, too narrow for the full figures, shows no figures at all', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...fullBand, props: { ...band.props, bodyColumns: 80 } })
  const drawn = await ui.drawn()
  await ui.unmount()
  expect(infoRows(drawn)).toBe(null)
  expect(statusLines(drawn).length).toBe(0)
  const t = flat(drawn)
  expect(t).toContain('Build the pricing section')
  for (const fact of ['5h', 'ctx', 'Session', 'sent']) expect(t).not.toContain(fact)
})

test('18. a wide terminal draws the info block as two columns of five lines', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...fullBand, props: { ...band.props, bodyColumns: 140 } })
  const rows = infoRows(await ui.drawn())
  await ui.unmount()
  expect(rows).not.toBe(null)
  expect(rows!.length).toBe(5)
  expect(flat(rows![0])).toContain('Session')
  expect(flat(rows![4])).toContain('Messages')
})

test('19. a job that ended in an error stays ended when a background turn finishes', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  await $.turn.complete({ reason: 'error', answer: 'API Error: overloaded', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Noted.', durationMs: 10, isAborted: false, turnId: 't2' } as never)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never).catch(() => {})
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  expect(t).toContain('Stuck')
  expect(t).not.toContain('All done')
  expect(t).not.toContain('Needs you')
})

test('20. an agent taking its next step clears a permission prompt', async ($, on) => {
  on('classic.Notification', () => ({}))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'ok' }))
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  await $.tool.call({ tool: 'Read', file_path: '/tmp/x', agentId: 'agent-1' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  expect(t).not.toContain('Needs you')
  expect(t).toContain('Working')
})

test('21. the box keeps its height when the first limit reading arrives', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', engineBand)
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  for (const cols of [86, 95, 100, 140]) {
    const props = { ...band.props, bodyColumns: cols }
    const a = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band, props })
    const before = countRows(await a.drawn())
    await a.unmount()
    await $.session.measure(statusMeasure as never)
    const b = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band, props })
    const after = countRows(await b.drawn())
    await b.unmount()
    expect(after).toBe(before)
  }
})

test('22. a narrow terminal never draws a line that can wrap', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', engineBand)
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))
  await $.session.measure(statusMeasure as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  for (const cols of [30, 40, 50, 60]) {
    const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...fullBand, props: { ...band.props, bodyColumns: cols } })
    const drawn = await ui.drawn()
    await ui.unmount()
    // Narrow cards show no figures (full or nothing), and the step names are cut at the edge
    expect(statusLines(drawn).length).toBe(0)
    expect(flat(drawn)).not.toContain('Session')
  }
})

test('23. counts, and what never counts as a message', () => {
  expect(shortCount(950)).toBe('950')
  expect(shortCount(86_400)).toBe('86k')
  expect(shortCount(999_600)).toBe('1M')
  expect(shortCount(1_120_000)).toBe('1.1M')
  expect(isNotTyped('[Request interrupted by user]')).toBe(true)
  expect(isNotTyped('<user-prompt-submit-hook>x</user-prompt-submit-hook>')).toBe(true)
  expect(isNotTyped('<task-notification>done</task-notification>')).toBe(true)
  expect(isNotTyped('Build the pricing page')).toBe(false)
})

// /clear (session.end with reason 'clear') isn't covered here: the test harness has no implementation
// to raise session.end against, so that path is checked by reading the hook alone

test('24. a background turn never changes a finished card, by to-do list or by plan', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await $.turn.start({ text: '<task-notification>agent finished</task-notification>', turnId: 't2' } as never)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: ['One', 'Two', 'Three'].map(content => ({ content, status: 'pending', activeForm: content })),
  } as never)
  await $.tool.call({ tool: PLAN, steps: ['Check the agent', 'Tell the person'] } as never)

  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  expect(t).toContain('All done')
  expect(t).toContain('2 of 2 steps done')
  expect(t).not.toContain('3 of 3')
  expect(t).not.toContain('Check the agent')
})

test('25. a slash command turn starts its own job instead of leaving the old card up', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await $.turn.start({ text: '/code-review high', turnId: 't2' } as never)

  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  expect(t).not.toContain('All done')
  expect(t).not.toContain('Build the pricing section')
})

test('26. the box sizes to the room: one line in a short window, every step and the full figures in a tall one', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  const at = async (maxRows: number, isFullscreen: boolean) => {
    const ui = await $.ui.mount({
      plugin: 'clawd-view', surface: 'terminal', ...band,
      props: { ...band.props, bodyColumns: 140, maxRows, scroll: { offset: 0, bodyRows: maxRows - 1 } },
      viewport: { columns: 145, rows: maxRows, isFullscreen },
    })
    const t = flat(await ui.drawn())
    await ui.unmount()
    return t
  }
  // Main screen: 18 and 20 rows leave room for one line naming the step; 40 rows have both
  for (const rows of [18, 20]) {
    expect(await at(rows, false)).not.toContain('5-hour limit')
    expect(await at(rows, false)).toContain('Build the pricing section')
  }
  for (const rows of [40]) {
    const t = await at(rows, false)
    expect(t).toContain('5-hour limit')
    expect(t).toContain('Build the pricing section')
    expect(t).toContain('Add the contact form')
  }
  // Fullscreen hands over its slot already: 14 rows there fit the block without halving, and
  // Clawd (part of this mod now) takes 5 more under the box
  expect(await at(19, true)).toContain('5-hour limit')
})

test('27. wide characters and emoji are measured in cells, never split', () => {
  expect(cellWidth('Build')).toBe(5)
  expect(cellWidth('料金')).toBe(4)
  expect(cellWidth('✅ a')).toBe(4)
  expect(cellWidth('✓ a')).toBe(3)
  expect(cellWidth(fitCells('料金セクションを作成する', 10))).toBe(10)
  expect(cellWidth(fitCells('Build', 10))).toBe(10)
  const cut = fitCells('😀😀😀', 4)
  expect(cellWidth(cut)).toBe(4)
  expect(cut.startsWith('😀…')).toBe(true)
  expect([...cut].every(ch => ch.codePointAt(0)! < 0xd800 || ch.codePointAt(0)! > 0xdfff)).toBe(true)
})

test('28. wide step names never push a row past the card', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['料金セクションを作成する料金セクション', '✅ Check the form'] } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band, props: { ...band.props, bodyColumns: 60 } })
  // Each step row: the innermost Box holding a step name, measured in terminal cells
  const rows: string[] = []
  const walk = (n: any): boolean => {
    if (n === null || n === undefined || typeof n !== 'object') return false
    if (Array.isArray(n)) return n.map(walk).some(Boolean)
    const inner = walk(n.children)
    if (n.props?.wrap !== undefined && /料金|Check the form/.test(flat(n))) expect(n.props.wrap).toBe('truncate-end')
    if (!inner && n.type === 'Box' && /料金|Check the form/.test(flat(n))) {
      rows.push(flat(n))
      return true
    }
    return inner
  }
  walk(await ui.drawn())
  await ui.unmount()
  expect(rows.length).toBe(2)
  for (const r of rows) expect(cellWidth(r)).toBeLessThanOrEqual(56)
})

test('29. Messages counts only prompts typed at Enter, never notices, peers or commands', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', engineBand)
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  const send = (text: string, kind: string) => $.prompt.submit({ text, wait: false, origin: { kind } } as never)
  await send('Build the pricing page', 'composer')
  await send('And the footer too', 'composer')
  await send('<task-notification>done</task-notification>', 'task-notification')
  await send('The agent-dock plugin sent a message: hi', 'peer')
  await send('/code-review high', 'composer')
  await $.turn.start({ text: 'Build the pricing page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)

  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...fullBand, props: { ...band.props, bodyColumns: 140 } })
  const t = flat(await ui.drawn())
  await ui.unmount()
  expect(t).toContain('2 sent')
})


test('30. a peer hand-back after a done card leaves the card done', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await $.turn.start({ text: 'Another Claude session sent a message:\n<agent-message from="a1">\nreport', turnId: 't2' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  expect(t).toContain('All done')
  expect(isNotTyped('The agent-dock plugin sent a message: hi')).toBe(true)
})

test('31. a background turn is never gated, with no card or after a stuck one', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  // No card at all (a fresh or cleared conversation)
  await $.turn.start({ text: '<task-notification>agent finished</task-notification>', turnId: 't0' } as never)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  // A typed turn that errors before its plan, then a background turn
  await $.turn.start({ text: 'Fix the page', turnId: 't1' } as never)
  await $.turn.complete({ reason: 'error', answer: 'API Error: overloaded', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await $.turn.start({ text: '<task-notification>agent finished</task-notification>', turnId: 't2' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Check the agent', 'Tell the person'] } as never)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
})

test('32. an idle prompt from a peer or plugin starts a background turn, the person\'s a job', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  // A peer's plain-looking text is still background, by its origin
  await $.prompt.submit({ text: 'Status update from the other window', wait: false, origin: { kind: 'peer' } } as never)
  await $.turn.start({ text: 'Status update from the other window', turnId: 't2' } as never)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  let ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  expect(flat(await ui.drawn())).toContain('All done')
  await ui.unmount()
  // The person's own prompt starts a job and arms the gate
  await $.prompt.submit({ text: 'Now add a blog page', wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'Now add a blog page', turnId: 't3' } as never)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeDefined()
  ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  expect(flat(await ui.drawn())).not.toContain('All done')
  await ui.unmount()
})

test('33. a prompt typed into a running background turn becomes the person\'s job', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await $.turn.start({ text: '<task-notification>agent finished</task-notification>', turnId: 't2' } as never)
  await $.prompt.submit({ text: 'Now add a blog page', wait: false, turnId: 't2', origin: { kind: 'composer' } } as never)
  // Joining a running turn never blocks the work already under way
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  await $.tool.call({ tool: PLAN, steps: ['Write the blog page', 'Link it'] } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  expect(t).toContain('Write the blog page')
  expect(t).not.toContain('All done')
})

test('34. with room for one row, the active step is the one shown', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Alpha step', 'Bravo step', 'Charlie step'] } as never)
  await $.tool.call({ tool: PROGRESS, step: 1, percent: 100 } as never)
  let sawOne = false
  for (const maxRows of [14, 16, 18, 20, 22, 24, 26, 28, 30]) {
    const ui = await $.ui.mount({
      plugin: 'clawd-view', surface: 'terminal', ...band,
      props: { ...band.props, bodyColumns: 140, maxRows, scroll: { offset: 0, bodyRows: maxRows - 1 } },
      viewport: { columns: 145, rows: maxRows, isFullscreen: false },
    } as never)
    const t = flat(await ui.drawn())
    await ui.unmount()
    // Whatever the room, the active step always shows
    expect(t).toContain('Bravo')
    if (!t.includes('Alpha') && !t.includes('Charlie')) sawOne = true
  }
  expect(sawOne).toBe(true)
})

test('35. emoji presentation, colored circles and joined emoji measure and cut whole', () => {
  expect(cellWidth('⚠️ Fix')).toBe(6)
  expect(cellWidth('☀️')).toBe(2)
  expect(cellWidth('🟠 Orange')).toBe(9)
  expect(cellWidth('👨‍👩‍👧')).toBe(2)
  expect(cellWidth('👍🏽')).toBe(2)
  expect(cellWidth('é')).toBe(1)
  const cut = fitCells('👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧', 4)
  expect(cut.includes('\u200D…')).toBe(false)
  expect(cellWidth(cut)).toBe(4)
  expect(cut.startsWith('👨‍👩‍👧')).toBe(true)
})

test('36. a slash command the person types starts a job but never holds tools back', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  await $.prompt.submit({ text: '/code-review high', wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: '<command-name>/code-review</command-name>', turnId: 't1' } as never)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
})

test('37. /clawd-stats prints the figures into the conversation once, as a snapshot that never redraws', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', engineBand)
  const ran: any = await $.command.run({ command: 'clawd-stats', args: '' } as never)
  expect(ran.text).toContain('Claude stats at')
  const mount = (text: string) => $.ui.mount({
    plugin: 'clawd-view', surface: 'terminal', component: 'CommandOutput',
    props: { command: 'clawd-stats', args: '', text, isErrored: false },
    viewport: { columns: 140, rows: 40, isFullscreen: false },
  } as never)
  const ui = await mount(ran.text)
  const t = flat(await ui.drawn())
  for (const label of ['Claude stats', 'Model', '5-hour limit', 'Weekly limit', 'Context', 'Cost', 'Session', 'Cache', 'Input', 'Output', 'Messages']) expect(t).toContain(label)
  // The row is a snapshot: a prompt sent after it changes the box's figures, never the row's, so it
  // never redraws (a redraw of a row partly scrolled into history prints it twice)
  await $.prompt.submit({ text: 'Next thing', origin: { kind: 'composer' } } as never).catch(() => {})
  expect(flat(await ui.drawn())).toBe(t)
  await ui.unmount()
  // The engine hands the row its text under the plugin's name: the snapshot still draws
  const named = await mount(`clawd-view: ${ran.text}`)
  expect(flat(await named.drawn())).toContain('5-hour limit')
  await named.unmount()
  // A second run in the same minute gets a row of its own
  const again: any = await $.command.run({ command: 'clawd-stats', args: '' } as never)
  expect(again.text).not.toBe(ran.text)
})

test('38. /clawd-view help prints the guide with the window sizes and commands', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  const ran: any = await $.command.run({ command: 'clawd-view', args: 'help' } as never)
  for (const part of ['getting the best view', '35 lines tall', 'Under 106 wide', '/clawd-stats', 'Cmd + minus']) expect(ran.text).toContain(part)
})
