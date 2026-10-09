import { expect, mock, test } from './kit'
import { fakeFiles, historyFiles, jsonl, transcriptPath, typedRow } from './fake-files'

const PLAN = 'mcp__clawd-view__plan_steps'
// The figures show in the fullscreen box and the side panel; the main screen's box leaves them out
const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 40, bodyColumns: 140, scroll: { offset: 0, bodyRows: 39 }, view: {} },
  viewport: { columns: 145, rows: 60, isFullscreen: true },
}
const flat = (n: any): string =>
  n == null || typeof n === 'boolean' ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(flat).join('') : flat(n.children ?? n.props?.children ?? '')
const sent = async ($: any) => {
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  return /(\d+) sent/.exec(t)?.[1] ?? t.slice(0, 300)
}

test('F11. a prompt that is blocked before it is sent is not counted', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('prompt.submit', () => ({ drop: 'blocked by a settings hook' }))
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  const r = await $.prompt.submit({ text: 'please do this', wait: false, turnId: 't1', origin: { kind: 'composer' } } as never)
  expect((r as any).drop).toBeDefined()
  expect(await sent($)).toBe('0')
})

test('F12. reading the transcript again corrects a live over-count', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('session.id', () => ({ value: 'sid-1' }))
  on('session.start', (_: unknown, e: any) => e)
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  fakeFiles(on, historyFiles('sid-1', { input: 10, output: 5, messages: 1, lastReply: null, cacheMinutes: null, firstAt: Date.parse('2026-10-08T07:00:00Z'), cost: 0, contextTokens: 10 }))
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  await $.prompt.submit({ text: 'Do X', wait: false, turnId: 't1', origin: { kind: 'composer' } } as never)
  await $.prompt.submit({ text: 'Do X', wait: false, origin: { kind: 'composer' } } as never)
  await $.session.start({ cwd: '/' } as never)
  expect(await sent($)).toBe('1')
})

test('F13. reading the transcript alone shows its count', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('session.id', () => ({ value: 'sid-1' }))
  on('session.start', (_: unknown, e: any) => e)
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  fakeFiles(on, historyFiles('sid-1', { input: 10, output: 5, messages: 1, lastReply: null, cacheMinutes: null, firstAt: Date.parse('2026-10-08T07:00:00Z'), cost: 0, contextTokens: 10 }))
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  await $.session.start({ cwd: '/' } as never)
  expect(await sent($)).toBe('1')
})

test('F21. when a turn ends the transcript is read back, so a prompt sent twice from the queue counts once', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-08T07:50:00Z') })
  mock.store(on)
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('session.id', () => ({ value: 'sid-1' }))
  on('session.start', (_: unknown, e: any) => e)
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  const fake = fakeFiles(on, historyFiles('sid-1', { input: 10, output: 5, messages: 0 }))
  await $.session.start({ cwd: '/' } as never)
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  // Typed while Claude works, pulled back, sent again: two submits, one prompt in the transcript
  await $.prompt.submit({ text: 'Do X', wait: false, turnId: 't1', origin: { kind: 'composer' } } as never)
  await $.prompt.submit({ text: 'Do X', wait: false, turnId: 't1', origin: { kind: 'composer' } } as never)
  expect(await sent($)).toBe('2')
  // The prompt lands in the transcript once
  const path = transcriptPath('sid-1')
  fake.files.set(path, fake.files.get(path) + jsonl([typedRow('Do X', Date.parse('2026-10-08T07:50:00Z'))]))
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await clock.advance(2000)
  expect(await sent($)).toBe('1')
})
