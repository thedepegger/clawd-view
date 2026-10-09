import { expect, mock, test } from './kit'
import { fakeFiles, historyFiles } from './fake-files'

// The figures show in the fullscreen box and the side panel; the main screen's box leaves them out
const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 60, bodyColumns: 120, scroll: { offset: 0, bodyRows: 59 }, view: {} },
  viewport: { columns: 145, rows: 60, isFullscreen: true },
}
const flat = (n: any): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n)
    : Array.isArray(n) ? n.map(flat).join('')
    : n && typeof n === 'object' ? flat(n.children ?? n.props?.children) : ''
const PLAN = 'mcp__clawd-view__plan_steps'
// The figures of a long resumed session, as its transcript adds them up
const REAL_HISTORY = { input: 189031311, output: 287548, messages: 78, lastReply: 1791406371472, cacheMinutes: 60 as const, firstAt: 1791393823579, cost: 37.4607666, contextTokens: 291190 }

function world(on: any, opts: { model: () => string; usage: () => any; history?: Parameters<typeof historyFiles>[1] }) {
  mock.store(on)
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: opts.usage() }) as never)
  on('session.model', () => ({ value: opts.model() }) as never)
  on('session.id', () => ({ value: '07a78762-a8d0-4327-a3bc-9f98fbf06874' }) as never)
  on('settings.read', () => ({ value: { effortLevel: 'high' } }) as never)
  fakeFiles(on, opts.history ? historyFiles('07a78762-a8d0-4327-a3bc-9f98fbf06874', opts.history) : {}, { zone: '+0600' })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('classic.PostModelSwitch', () => ({}))
}
async function draw($: any) {
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  return t
}

test('F3. /model mid-session shows the new model straight away', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_791_406_400_000 })
  let model = 'claude-opus-5-5[1m]'
  world(on, { model: () => model, usage: () => ({ startedAt: 1, context: { window: 1_000_000 }, rateLimits: [] }), history: REAL_HISTORY })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.advance(3100)
  await $.tool.call({ tool: PLAN, steps: ['Look', 'Fix'] } as never)
  expect(await draw($)).toContain('Opus 5.5')
  // The person runs /model sonnet: the engine's model is now Sonnet
  model = 'claude-sonnet-5'
  await $.classic.PostModelSwitch({ from_model: 'claude-opus-5-5[1m]', to_model: 'claude-sonnet-5', requested_model: 'sonnet', source: 'command' } as never)
  await clock.advance(15_000) // three ticks, the third a slow one that reads the model again
  const t = await draw($)
  expect(t).toContain('Sonnet 5')
})

test('F4. before the first reply Context shows no made-up 0%', async ($, on) => {
  const clock = mock.clock(on, { now: 1_791_406_400_000 })
  world(on, { model: () => 'claude-opus-5-5[1m]', usage: () => ({ startedAt: 1_791_406_400_000, context: { window: 1_000_000 }, rateLimits: [] }) })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.advance(3100)
  await $.tool.call({ tool: PLAN, steps: ['Look', 'Fix'] } as never)
  const t = await draw($)
  expect(t).not.toMatch(/Context[^A-Za-z]*0%/)
})

test('F5. after a resume Context comes from the transcript before the first reply', async ($, on) => {
  const clock = mock.clock(on, { now: 1_791_406_400_000 })
  world(on, { model: () => 'claude-opus-5-5[1m]', usage: () => ({ startedAt: 1, context: { window: 1_000_000 }, rateLimits: [] }), history: REAL_HISTORY })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.advance(3100)
  await $.tool.call({ tool: PLAN, steps: ['Look', 'Fix'] } as never)
  const t = await draw($)
  expect(t).toMatch(/29%/)
  expect(t).toContain('Opus 5.5 high')
})
