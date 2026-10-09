import { expect, mock, test } from './kit'
import { fakeFiles, historyFiles } from './fake-files'

// The figures show in the fullscreen box and the side panel; the main screen's box leaves them out
const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 40, bodyColumns: 120, scroll: { offset: 0, bodyRows: 39 }, view: {} },
  viewport: { columns: 145, rows: 60, isFullscreen: true },
}
const flat = (n: any): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n)
    : Array.isArray(n) ? n.map(flat).join('')
    : n && typeof n === 'object' ? flat(n.children ?? n.props?.children) : ''
const usage = { startedAt: 1_000_000, context: { window: 200000 }, rateLimits: [] }
const step = (agentId?: string) => ({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) })
const result = (i: number, o: number) => ({
  turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn',
  usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' },
})
const shown = async ($: any) => {
  await $.tool.call({ tool: 'mcp__clawd-view__plan_steps', steps: ['Do it'] } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  return t
}

test('F8. a step that lands while the transcript is read is still counted', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  mock.store(on)
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('session.id', () => ({ value: 'S' }) as never)
  on('tool.register', () => ({ value: {} }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: {} }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.usage', () => ({ value: usage }) as never)
  // the scan read the transcript before the step below was written, and returns 1s later
  fakeFiles(on, historyFiles('S', { input: 1_000_000, output: 100_000 }), { gate: () => gate })
  on('turn.step', async function* () { return result(500_000, 50_000) as never })
  const started = $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(10)
  for await (const _ of $.turn.step(step() as never)) { /* drain */ }
  release()
  await clock.advance(5000)
  await started
  const t = await shown($)
  // truth: 1.5M in, 150k out
  expect(t).toContain('1.5M tokens')
  expect(t).toContain('150k tokens')
})

test('F9. a compaction counts its tokens', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }], usage: { input_tokens: 735_713, output_tokens: 9_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }) as never)
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'x', toolUses: [] }] } as never).catch(() => null)
  const t = await shown($)
  expect(t).toContain('736k tokens')
})

test('F10. an open box redraws Input and Output when a step lands', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('turn.step', async function* () { return result(1234, 56) as never })
  await $.tool.call({ tool: 'mcp__clawd-view__plan_steps', steps: ['Do it'] } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const before = flat(await ui.drawn())
  for await (const _ of $.turn.step(step() as never)) { /* drain */ }
  const after = flat(await ui.drawn())
  await ui.unmount()
  expect(before).toContain('Input       0 tokens')
  expect(after).toContain('Input       1k tokens')
  expect(after).toContain('Output      56 tokens')
})
