import { expect, mock, test } from './kit'
import { addRow, historyOf, newHistoryScan } from '../hooks/clawd-view'
import { CONFIG, HOME, fakeFiles, jsonl, replyRow, transcriptPath, typedRow } from './fake-files'

const PLAN = 'mcp__clawd-view__plan_steps'
// The figures show in the fullscreen box; the main screen's box leaves them out
const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 40, bodyColumns: 140, scroll: { offset: 0, bodyRows: 39 }, view: {} },
  viewport: { columns: 145, rows: 60, isFullscreen: true },
}
const flat = (n: any): string =>
  n == null || typeof n === 'boolean' ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
    : Array.isArray(n) ? n.map(flat).join('') : flat(n.children ?? n.props?.children)
const draw = async ($: any) => {
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  return t.slice(t.indexOf('Model'))
}
const T0 = Date.parse('2026-10-07T09:00:00Z')

function session(on: any, sid: string, opts: { settings?: object } = {}) {
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('session.id', () => ({ value: sid }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.usage', () => ({ value: { startedAt: T0 - 60_000, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('settings.read', () => ({ value: opts.settings ?? {} }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
}

// Synthetic rows covering every rule of the history scan. The figures expected from them are the
// ones the old Python reader printed for these same rows
const MAIN = [
  { type: 'user', timestamp: '2026-10-01T10:00:05.000Z', message: { role: 'user', content: 'Build the page' } },
  { type: 'system', timestamp: '2026-10-01T10:00:00.000Z' },
  { type: 'assistant', timestamp: '2026-10-01T10:00:10.000Z', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50, output_tokens: 5, cache_creation: { ephemeral_1h_input_tokens: 50 } } } },
  { type: 'assistant', timestamp: '2026-10-01T10:00:12.000Z', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50, output_tokens: 300, cache_creation: {} } } },
  { type: 'user', timestamp: '2026-10-01T10:01:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
  { type: 'user', timestamp: '2026-10-01T10:01:30.000Z', message: { role: 'user', content: '<system-reminder>be brief</system-reminder>' } },
  { type: 'user', timestamp: '2026-10-01T10:01:40.000Z', message: { role: 'user', content: '/model' } },
  { type: 'user', timestamp: '2026-10-01T10:01:50.000Z', message: { role: 'user', content: [{ type: 'text', text: '  Fix the bug ' }, { type: 'image' }] } },
  { type: 'user', timestamp: '2026-10-01T10:02:00.000Z', isMeta: true, message: { role: 'user', content: 'Hello' } },
  { type: 'user', timestamp: '2026-10-01T10:02:05.000Z', origin: { kind: 'peer' }, message: { role: 'user', content: 'Hi from a peer' } },
  { type: 'user', timestamp: '2026-10-01T10:02:10.000Z', origin: { kind: 'human' }, message: { role: 'user', content: 'Yes please' } },
  { type: 'attachment', timestamp: '2026-10-01T10:02:20.000Z', attachment: { type: 'queued_command', origin: { kind: 'human' }, prompt: 'Also do Y' } },
  { type: 'attachment', timestamp: '2026-10-01T10:02:21.000Z', attachment: { type: 'queued_command', prompt: 'No origin' } },
  { type: 'attachment', timestamp: '2026-10-01T10:02:22.000Z', attachment: { type: 'queued_command', origin: { kind: 'human' }, prompt: '<task-notification>done</task-notification>' } },
  { type: 'user', timestamp: '2026-10-01T10:02:30.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
  { type: 'assistant', timestamp: '2026-10-01T10:03:00.000Z', message: { id: 'm2', model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 2000, output_tokens: 40, iterations: [{ type: 'message', input_tokens: 999 }, { type: 'advisor_message', input_tokens: 7, cache_read_input_tokens: 3, output_tokens: 2 }], cache_creation: { ephemeral_5m_input_tokens: 20 } } } },
  { type: 'assistant', timestamp: '2026-10-01T10:03:05.000Z', message: { id: 'm3', model: '<synthetic>', usage: { input_tokens: 5000, output_tokens: 5000 } } },
  { type: 'assistant', timestamp: '2026-10-01T10:03:06.000Z', message: { id: 'm4', model: 'claude-opus-5-5' } },
  { type: 'cost-state', totalCostUSD: 1.5 },
  { type: 'cost-state', totalCostUSD: 2.25 },
  { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-01T10:04:00.000Z', compactMetadata: { preTokens: 5000 } },
]
const AGENT = [
  { type: 'user', timestamp: '2026-10-01T09:00:00.000Z', message: { role: 'user', content: 'Agent task' } },
  { type: 'assistant', timestamp: '2026-10-01T10:02:40.000Z', message: { id: 'a1', model: 'claude-haiku-4-5', usage: { input_tokens: 300, output_tokens: 30 } } },
  { type: 'cost-state', totalCostUSD: 99 },
]
const WORKFLOW_AGENT = [
  { type: 'assistant', timestamp: '2026-10-01T10:02:45.000Z', message: { id: 'a2', model: 'claude-haiku-4-5', usage: { input_tokens: 7, output_tokens: 3 } } },
]
const JOURNAL = [
  { type: 'assistant', timestamp: '2026-10-01T10:02:50.000Z', message: { id: 'j1', model: 'claude-haiku-4-5', usage: { input_tokens: 1000000, output_tokens: 1 } } },
]
const EXPECTED = { input: 8477, output: 375, messages: 4, lastReply: 1790848950000, cacheMinutes: 5, firstAt: 1790848800000, cost: 2.25, contextTokens: 2050 }

test('D1. transcript rows add up exactly as the old Python reader added them', () => {
  const s = newHistoryScan('sid-x')
  for (const row of MAIN) addRow(s, row, true)
  for (const row of [...AGENT, ...WORKFLOW_AGENT]) addRow(s, row, false)
  expect(historyOf(s, '/p/sid-x.jsonl', 10)).toEqual({ ...EXPECTED, path: '/p/sid-x.jsonl', size: 10 })
})

test('D2. the transcript, agents\' and workflow agents\' transcripts and /usage\'s cache are found under CLAUDE_CONFIG_DIR', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  session(on, 'sid-x')
  const cfg = '/elsewhere/claude-config'
  const dir = `${cfg}/projects/-work-site`
  const fake = fakeFiles(on, {
    // A line that is not JSON, and one that is not an object, are passed over
    [`${dir}/sid-x.jsonl`]: 'not json\n[1,2]\n' + jsonl(MAIN),
    [`${dir}/sid-x/subagents/agent-x.jsonl`]: jsonl(AGENT),
    [`${dir}/sid-x/subagents/agent-x.meta.json`]: '{}',
    [`${dir}/sid-x/subagents/workflows/w1/agent-y.jsonl`]: jsonl(WORKFLOW_AGENT),
    [`${dir}/sid-x/subagents/workflows/w1/journal.jsonl`]: jsonl(JOURNAL),
    [`${cfg}/.claude.json`]: JSON.stringify({ numStartups: 2, cachedUsageUtilization: { fetchedAtMs: T0 - 60_000, utilization: { five_hour: { utilization: 2.5, resets_at: '2026-10-07T11:30:00+00:00' }, seven_day: { utilization: 77.5 } } } }),
    // The home folder's copies are not the ones in use
    [`${CONFIG}/projects/-work-site/sid-x.jsonl`]: jsonl([replyRow('wrong', T0, { input_tokens: 9_000_000, output_tokens: 9_000_000 })]),
    [`${HOME}/.claude.json`]: JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: T0, utilization: { five_hour: { utilization: 55 } } } }),
  }, { env: { CLAUDE_CONFIG_DIR: `${cfg}/` } })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  const t = await draw($)
  expect(t).toMatch(/Input\s*8k tokens/)
  expect(t).toMatch(/Output\s*375 tokens/)
  expect(t).toContain('4 sent')
  // Rounded as before: 2.5 -> 2, 77.5 -> 78
  expect(t).toMatch(/5-hour limit[^A-Za-z]*2%/)
  expect(t).toMatch(/Weekly limit[^A-Za-z]*78%/)
  expect(fake.reads.some(p => p.endsWith('journal.jsonl') || p.endsWith('.meta.json') || p.startsWith(HOME))).toBe(false)
  expect(fake.reads).toContain(`${dir}/sid-x/subagents/workflows/w1/agent-y.jsonl`)
})

test('D3. a later pass reads only what was written since, and leaves unchanged files alone', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  session(on, 'sid-1')
  const main = transcriptPath('sid-1')
  const agent = `${CONFIG}/projects/-tmp/sid-1/subagents/agent-a.jsonl`
  const fake = fakeFiles(on, {
    [main]: jsonl([typedRow('First', T0 - 60_000), replyRow('r1', T0 - 50_000, { input_tokens: 1_000_000, output_tokens: 100_000 })]),
    [agent]: jsonl([replyRow('a1', T0 - 40_000, { input_tokens: 500_000, output_tokens: 50_000 })]),
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  const a = await draw($)
  expect(a).toMatch(/Input\s*1.5M tokens/)
  expect(a).toContain('1 sent')
  // A prompt and its reply are written; the agent's transcript is not touched
  fake.files.set(main, fake.files.get(main) + jsonl([typedRow('Second', T0), replyRow('r2', T0 + 1000, { input_tokens: 500_000, output_tokens: 50_000 })]))
  for (let i = 0; i < 6; i++) await clock.advance(5_000)
  const b = await draw($)
  expect(b).toMatch(/Input\s*2M tokens/)
  expect(b).toMatch(/Output\s*200k tokens/)
  expect(b).toContain('2 sent')
  expect(fake.reads.filter(p => p === agent).length).toBe(1)
  // Nothing new: nothing read again
  const before = fake.reads.length
  for (let i = 0; i < 6; i++) await clock.advance(5_000)
  expect(fake.reads.length).toBe(before)
})

test('D4. a transcript over 4 MiB is read from where the last pass stopped, a row longer than one piece passed over', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  session(on, 'sid-big')
  const main = transcriptPath('sid-big')
  const long = { type: 'user', timestamp: new Date(T0).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', content: 'x'.repeat(1000) }] } }
  const fake = fakeFiles(on, {
    [main]: jsonl([typedRow('Hello', T0 - 60_000), long, replyRow('r1', T0 - 50_000, { input_tokens: 1_500_000, output_tokens: 150_000 }), typedRow('Again', T0 - 40_000)]),
  }, { tailChunk: 300 })
  fake.big.add(main)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  const t = await draw($)
  expect(t).toMatch(/Input\s*1.5M tokens/)
  expect(t).toMatch(/Output\s*150k tokens/)
  expect(t).toContain('2 sent')
  expect(fake.reads).not.toContain(main)
  expect(fake.tails.filter(p => p === main).length).toBeGreaterThan(3)
})

test('D5. nothing is run through PATH and nothing runs Python, through a start, a turn and minutes of ticks', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  session(on, 'sid-1')
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  const fake = fakeFiles(on, { [transcriptPath('sid-1')]: jsonl([typedRow('Hello', T0)]), [`${HOME}/.claude.json`]: '{}' }, { zone: '+0530' })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: PLAN, steps: ['One'] } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  for (let i = 0; i < 30; i++) await clock.advance(5_000)
  expect(fake.runs.length).toBeGreaterThan(0)
  for (const argv of fake.runs) {
    expect(argv[0]!.startsWith('/')).toBe(true)
    expect(argv.join(' ')).not.toMatch(/python/i)
  }
  expect(fake.runs.some(a => a[0] === '/bin/date')).toBe(true)
})

test('D6. the effort is kept in one entry for the newest 20 sessions, and the old per-session keys are swept', async ($, on) => {
  mock.clock(on, { now: T0 })
  const old = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`s${i}`, 'low']))
  const db = new Map<string, unknown>([['statusEffort', old], ['statusEffort:gone-1', 'high'], ['statusEffort:gone-2', 'max'], ['statusIsOn', true]])
  on('store.get', (_: unknown, e: any) => ({ value: db.get(e.key) }))
  on('store.set', (_: unknown, e: any) => { db.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.keys', () => ({ value: [...db.keys()] }))
  on('store.delete', (_: unknown, e: any) => { db.delete(e.key); return { value: undefined } })
  session(on, 'sid-now')
  fakeFiles(on, {})
  on('turn.step', async function* (_: unknown, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'x' } }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  const st = ($ as any).turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, effort: 'xhigh' })
  for await (const _ of st) { /* drain */ }
  await st.result
  await draw($)
  const kept = db.get('statusEffort') as Record<string, string>
  expect(Object.keys(kept).length).toBe(20)
  expect(Object.keys(kept).at(-1)).toBe('sid-now')
  expect(kept['sid-now']).toBe('xhigh')
  expect(kept.s0).toBeUndefined()
  expect(kept.s24).toBe('low')
  expect([...db.keys()].filter(k => k.startsWith('statusEffort:'))).toEqual([])
  expect(db.get('statusIsOn')).toBe(true)
})

test('D7. before the first request an effort set by CLAUDE_EFFORT shows over settings', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  session(on, 'sid-1', { settings: { effortLevel: 'low' } })
  fakeFiles(on, {}, { env: { CLAUDE_EFFORT: 'max' } })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  expect(await draw($)).toContain('Opus 5.5 max')
})

test('D8. a session\'s own saved effort still wins over the environment', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on, { statusEffort: { 'sid-1': 'medium' } })
  session(on, 'sid-1', { settings: { effortLevel: 'low' } })
  fakeFiles(on, {}, { env: { CLAUDE_EFFORT: 'max' } })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  expect(await draw($)).toContain('Opus 5.5 medium')
})

test('D9. /clawd-stats prints the figures even with the stats in the box switched off', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  const off: any = await $.command.run({ command: 'clawd-status', args: 'off' } as never)
  expect(off.text).toBe('Status row is off.')
  const ran: any = await $.command.run({ command: 'clawd-stats', args: '' } as never)
  const ui = await $.ui.mount({
    plugin: 'clawd-view', surface: 'terminal', component: 'CommandOutput',
    props: { command: 'clawd-stats', args: '', text: ran.text, isErrored: false },
    viewport: { columns: 140, rows: 40, isFullscreen: false },
  } as never)
  const t = flat(await ui.drawn())
  await ui.unmount()
  expect(t).not.toContain('The figures are off')
  for (const label of ['Claude stats', 'Model', '5-hour limit', 'Input', 'Messages']) expect(t).toContain(label)
})

test('D10. /clawd-stats answers in plain words when its figures cannot be read', async ($, on) => {
  // No clock: reading the time fails
  mock.store(on)
  const ran: any = await $.command.run({ command: 'clawd-stats', args: '' } as never)
  expect(ran.text).toBe('The stats could not be read. Try again.')
})
