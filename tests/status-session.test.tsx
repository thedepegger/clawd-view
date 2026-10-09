import { expect, mock, test } from './kit'
import { fakeFiles, historyFiles } from './fake-files'

const PLAN = 'mcp__clawd-view__plan_steps'
// The figures show in the fullscreen box and the side panel; the main screen's box leaves them out
const band = { component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: true, maxRows: 40, bodyColumns: 120, scroll: { offset: 0, bodyRows: 39 }, view: {} },
  viewport: { columns: 145, rows: 60, isFullscreen: true } }
const flat = (n: any): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n)
    : Array.isArray(n) ? n.map(flat).join('')
    : n && typeof n === 'object' ? flat(n.children ?? n.props?.children) : ''
const T0 = Date.parse('2026-10-07T20:53:29Z')
const LAUNCH = Date.parse('2026-10-07T17:23:31.169Z') // SessionStart hook_success row, the real launch
const FIRST_ROW = Date.parse('2026-10-07T17:23:43.579Z') // first timestamped row in file order

function world(on: any, opts: { usageFails?: boolean; startedAt?: number; history?: Parameters<typeof historyFiles>[1] }) {
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('session.id', () => ({ value: 'sid-1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.usage', () => {
    if (opts.usageFails) return { value: { context: { window: 1_000_000 }, rateLimits: [] } }
    return { value: { startedAt: opts.startedAt, context: { window: 1_000_000 }, rateLimits: [] } }
  })
  on('settings.read', () => ({ value: {} }))
  on('session.start', () => ({ cwd: '/x' }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  fakeFiles(on, opts.history ? historyFiles('sid-1', opts.history) : {}, { zone: '+0600' })
}
const sessionLine = (t: string) => (t.match(/Session\s*(\d+h \d+m|\d+m)/) ?? [])[1]

test('F1. the Session minute is never behind the clock between ticks', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  world(on, { startedAt: T0 - 50_000 })
  await $.session.start({ cwd: '/x' } as never)
  await $.tool.call({ tool: PLAN, steps: ['One'] } as never)
  await clock.advance(12_000) // real elapsed 62s
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  expect(sessionLine(t)).toBe('1m')
})

test('F2. after a resume the Session time counts from the first launch and keeps counting while idle', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  world(on, { startedAt: LAUNCH, history: { input: 1, output: 1, messages: 1, firstAt: FIRST_ROW } })
  await $.session.start({ cwd: '/x' } as never)
  await $.tool.call({ tool: PLAN, steps: ['One'] } as never)
  // Idle for real: a finished card has no 250 ms frame clock redrawing the box through the advance
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const a = sessionLine(flat(await ui.drawn()))
  await clock.advance(2 * 60_000)
  const b = sessionLine(flat(await ui.drawn()))
  await ui.unmount()
  expect(a).toBe('3h 29m')
  expect(b).toBe('3h 31m')
})
