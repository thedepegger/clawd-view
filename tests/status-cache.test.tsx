import { expect, mock, test } from './kit'
import { fakeFiles, historyFiles } from './fake-files'

const PLAN = 'mcp__clawd-view__plan_steps'
// The figures show in the fullscreen box and the side panel; the main screen's box leaves them out
const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 40, bodyColumns: 140, scroll: { offset: 0, bodyRows: 39 }, view: {} },
  viewport: { columns: 145, rows: 60, isFullscreen: true },
}
const engineBand = () => ({ type: 'Box' as const, props: {}, children: [] })
const flat = (n: any): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n)
    : Array.isArray(n) ? n.map(flat).join('')
    : n && typeof n === 'object' ? flat(n.children ?? n.props?.children) : ''
const cacheOf = (t: string) => (t.match(/Cache\s+([^A-Z]*?(left|expired|starts on reply))/) ?? [])[1]

const T0 = Date.parse('2026-10-07T20:00:00Z')
function world(on: any, lastReply: number | null, sid = 's1') {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  on('ui.render', engineBand)
  on('session.id', () => ({ value: sid }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: T0 - 3_600_000, context: { tokens: 1000, window: 1_000_000, percent: 1 }, rateLimits: [] } }))
  on('settings.read', () => ({ value: {} }))
  fakeFiles(on, historyFiles(sid, { input: 10, output: 5, messages: 1, lastReply, cacheMinutes: 60, firstAt: T0 - 3_600_000, cost: 1 }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('session.start', (_: unknown, e: any) => ({ cwd: '/tmp' }))
  on('tool.register', () => ({ value: {} }))
  on('command.register', () => ({ value: {} }))
  on('turn.step', async function* (_: unknown, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, model: 'x' } }
  })
  return clock
}

async function step($: any, e: any) { const st = $.turn.step(e); for await (const _ of st) {} return await st.result }

test('F6. the cache countdown keeps counting down on an idle finished card', { timeoutMs: 20_000 }, async ($, on) => {
  // The reply 50 minutes ago: ten minutes of countdown to watch, not an hour of 5 s ticks to wait through
  const clock = world(on, T0 - 50 * 60_000)
  await ($ as any).session.start({ cwd: '/tmp' })
  await clock.advance(0)
  await $.tool.call({ tool: PLAN, steps: ['Do the thing'] } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const a = cacheOf(flat(await ui.drawn()))
  await clock.advance(60_000)
  const b = cacheOf(flat(await ui.drawn()))
  await clock.advance(10 * 60_000)
  const c = cacheOf(flat(await ui.drawn()))
  await ui.unmount()
  expect(a).toBe('10m left')
  expect(b).toBe('9m left')
  expect(c).toBe('expired')
})

test('F7. a main request restarts the cache clock from when it was sent; an agent request does not', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = world(on, T0 - 50 * 60_000)
  await ($ as any).session.start({ cwd: '/tmp' })
  await clock.advance(0)
  await $.tool.call({ tool: PLAN, steps: ['Do the thing'] } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const a = cacheOf(flat(await ui.drawn()))
  await clock.advance(60_000)
  await step($, { turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 2, agentId: 'ag1' })
  const b = cacheOf(flat(await ui.drawn()))
  await step($, { turnId: 't', index: 1, model: 'claude-opus-5-5', messageCount: 3 })
  const r = await step($, { turnId: 't', index: 2, model: 'claude-opus-5-5', messageCount: 3 })
  const c = cacheOf(flat(await ui.drawn()))
  await ui.unmount()
  const ui2 = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  await ui2.unmount()
  expect(a).toBe('10m left')
  expect(b).toBe('9m left')
  expect(c).toBe('1h 0m left')
})
