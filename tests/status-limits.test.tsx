import { expect, mock, test } from './kit'
import { HOME, fakeFiles, historyFiles } from './fake-files'

const PLAN = 'mcp__clawd-view__plan_steps'
// The figures show in the fullscreen box and the side panel; the main screen's box leaves them out
const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 40, bodyColumns: 140, scroll: { offset: 0, bodyRows: 39 }, view: {} },
  viewport: { columns: 145, rows: 60, isFullscreen: true },
}
const flat = (n: any): string =>
  n == null || typeof n === 'boolean' ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
    : Array.isArray(n) ? n.map(flat).join('') : flat(n.children ?? n.props?.children)

const T0 = Date.parse('2026-10-07T20:00:00Z')
const RESET = '2026-10-07T22:10:00.000Z'

function world(on: any, opts: { hostLimits?: any[]; store?: Record<string, unknown>; cost?: number; usageCache?: object; history?: Parameters<typeof historyFiles>[1] }) {
  const clock = mock.clock(on, { now: T0 })
  const db = new Map<string, unknown>(Object.entries(opts.store ?? {}))
  on('store.get', (_: unknown, e: any) => ({ value: db.get(e.key) }))
  on('store.set', (_: unknown, e: any) => { db.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.keys', () => ({ value: [...db.keys()] }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid-A' }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.usage', () => ({ value: { startedAt: T0 - 3_600_000, context: { window: 1_000_000 }, rateLimits: opts.hostLimits ?? [], cost: opts.cost === undefined ? undefined : { usd: opts.cost } } }))
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))
  fakeFiles(on, {
    ...(opts.history ? historyFiles('sid-A', opts.history) : {}),
    ...(opts.usageCache ? { [`${HOME}/.claude.json`]: JSON.stringify(opts.usageCache) } : {}),
  }, { zone: '+0600' })
  return { clock, db }
}

const draw = async ($: any) => {
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  return t.slice(t.indexOf('Model'))
}
const fiveLine = (t: string) => t.slice(t.indexOf('5-hour limit'), t.indexOf('Weekly limit'))

test('F14. a newer limit reading saved by another session reaches an open box', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, db } = world(on as any, {})
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  await $.session.measure({ context: { window: 1_000_000, percent: 10 }, rateLimits: [{ kind: 'five_hour', percentUsed: 15, resetsAt: RESET }], changed: ['rateLimits'] } as never)
  // Session B (same store file) saves a newer account-wide reading 10 minutes later
  // In 10s steps: Clawd's 20ms timer runs too, and one advance holds 10,000 waits at most
  for (let i = 0; i < 60; i++) await clock.advance(10_000)
  db.set('statusLimits', { at: clock.now(), limits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: RESET }] })
  // Several 15s ticks go by
  for (let i = 0; i < 6; i++) await clock.advance(10_000)
  const t = await draw($)
  expect(fiveLine(t)).toContain('40%')
})

test('F15. a start or reload never lets the engine\'s older reading replace a newer saved one', async ($, on) => {
  // Saved a minute ago by another session: 40%. The host's own last reply (an hour ago) said 15%.
  const { db } = world(on as any, {
    store: { statusLimits: { at: T0 - 60_000, limits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: RESET }] } },
    hostLimits: [{ kind: 'five_hour', percentUsed: 15, resetsAt: RESET }],
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  const t = await draw($)
  const saved = db.get('statusLimits') as any
  expect(fiveLine(t)).toContain('40%')
})

test('F16. real saved and /usage readings show the right percent and local reset time', async ($, on) => {
  const real = { at: 1791406435494, limits: [{ kind: 'five_hour', percentUsed: 15, resetsAt: '2026-10-07T22:10:00.000Z' }, { kind: 'seven_day', percentUsed: 6, resetsAt: '2026-10-14T15:00:00.000Z' }] }
  // Claude Code's own /usage cache, in .claude.json
  const usage = { numStartups: 3, cachedUsageUtilization: { fetchedAtMs: 1791356788399, utilization: {
    five_hour: { utilization: 3, resets_at: '2026-10-07T11:30:00.283637+00:00' },
    seven_day: { utilization: 78, resets_at: '2026-10-07T15:00:00.283655+00:00' },
  } } }
  const { clock } = world(on as any, { store: { statusLimits: real }, usageCache: usage })
  await clock.set(1791406700000)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  const t = await draw($)
  expect(t).toContain('15%')
  expect(t).toContain('resets 4:10 AM')
  expect(t).toContain('6%')
  expect(t).toContain('resets Wednesday 9 PM')
})

import { pickLimits } from '../hooks/clawd-view'
test('F17. /usage reset times parse, and passed windows wait for the next reply', () => {
  const r = { source: 'usage' as const, at: 1791356788399, limits: [{ kind: 'five_hour', percentUsed: 3, resetsAt: '2026-10-07T11:30:00.283637+00:00' }, { kind: 'seven_day', percentUsed: 78, resetsAt: '2026-10-07T15:00:00.283655+00:00' }] }
  const v = pickLimits([r], 1791406700000)
  expect(v.every(x => x.isFresh)).toBe(true)
})

test('F18. with nothing else happening, a passed 5-hour window updates on screen', async ($, on) => {
  const reset = Date.parse(RESET)
  const { clock } = world(on as any, { store: { statusLimits: { at: reset - 600_000, limits: [{ kind: 'five_hour', percentUsed: 15, resetsAt: RESET }] } } })
  await clock.set(reset - 10_000)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  const a = fiveLine(await draw($))
  await clock.advance(30_000)
  const b = fiveLine(await draw($))
  expect(a).toContain('15%')
  expect(b).toContain('updates on next reply')
})

test('F19. right after a resume the cost reads the transcript total while the live total still says 0', async ($, on) => {
  world(on as any, { cost: 0, history: { input: 10, output: 5, messages: 1, cost: 37.46 } })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  expect(await draw($)).toContain('$37.46')
})

test('F20. a brand-new session shows Cost as $0.00', async ($, on) => {
  world(on as any, { cost: 0 })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  expect(await draw($)).toContain('$0.00')
})
