import { expect, mock, test } from './kit'

import { AGENT_COLORS, MODEL_COLORS, OTHER_AGENT_COLOR, OTHER_MODEL_COLOR, agentAction, agentTarget, agentTokens, shortModel } from '../hooks/clawd-view'

// The agent line: one row under the steps with the model's badge, the agent's name in its kind's
// color, what it's doing, and its tokens (↑) and time

const PLAN = 'mcp__clawd-view__plan_steps'

const kids = (n: any): any[] => {
  const c = n?.children ?? n?.props?.children
  if (c === undefined || c === null) return []
  return (Array.isArray(c) ? c.flat(Infinity) : [c]).filter((x: any) => x !== null && x !== undefined && x !== false && x !== '')
}
const flat = (n: any): string =>
  n === null || n === undefined || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(flat).join('') : kids(n).map(flat).join('')
// The node keyed "news": the agent line
const findKey = (n: any, key: string): any => {
  if (n === null || typeof n !== 'object') return undefined
  if (Array.isArray(n)) { for (const k of n) { const f = findKey(k, key); if (f) return f } return undefined }
  if (n.key === key || n.props?.key === key) return n
  return findKey(kids(n), key)
}
const band = (cols: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 40, bodyColumns: cols, scroll: { offset: 0, bodyRows: 39 }, view: {} },
})
const step = (agentId: string, model: string) => ({ turnId: 't', index: 0, model, messageCount: 1, agentId })
const result = (i: number, o: number) => ({
  turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn',
  usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'x' },
})

// CIE76 distance between two colors: under about 10 they start to look alike
function lab(hex: string): number[] {
  const lin = [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16) / 255).map(v => (v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92))
  const [r, g, b] = lin as [number, number, number]
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
const distance = (a: string, b: string) => { const p = lab(a), q = lab(b); return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!) }

test('A1. models and kinds of agent each have their own colors, and no model color looks like an agent color', () => {
  const models = [...Object.values(MODEL_COLORS), OTHER_MODEL_COLOR]
  const agents = [...Object.values(AGENT_COLORS), OTHER_AGENT_COLOR]
  expect(new Set(models).size).toBe(models.length)
  expect(new Set(agents).size).toBe(agents.length)
  for (const m of models) for (const a of agents) expect(distance(m, a)).toBeGreaterThan(20)
})

test('A2. model ids, targets, tokens and actions read short and plain', () => {
  expect(shortModel('claude-haiku-5-5')).toBe('haiku')
  expect(shortModel('claude-sonnet-5-5[1m]')).toBe('sonnet')
  expect(shortModel('opus')).toBe('opus')
  expect(shortModel('claude-fable-5-1')).toBe('fable')
  expect(shortModel(undefined)).toBeUndefined()
  expect(agentTarget({ file_path: '/x/src/checkout.ts' })).toBe('checkout.ts')
  expect(agentTarget({ pattern: 'debounce' })).toBe('debounce')
  expect(agentTarget({ command: 'npm test --watch' })).toBe('npm test')
  expect(agentTarget({ url: 'https://docs.stripe.com/api' })).toBe('docs.stripe.com')
  expect(agentTokens(940)).toBe('940')
  expect(agentTokens(12_400)).toBe('12.4k')
  expect(agentTokens(184_300)).toBe('184k')
  expect(agentTokens(1_200_000)).toBe('1.2M')
  expect(agentAction({ description: '', status: 'running', tool: 'Read', target: 'checkout.ts', doing: 'reading files' })).toBe('reading checkout.ts')
  expect(agentAction({ description: '', status: 'running', tool: 'Agent', target: '', doing: 'thinking' })).toBe('thinking')
  expect(agentAction({ description: '', status: 'idle' })).toBe('waiting')
  expect(agentAction({ description: '', status: 'completed' })).toBe('finished')
})

test('A3. an agent shows its model, name, action, ↑ tokens and time on one row, wide and narrow', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', () => ({ type: 'Box' as const, props: {}, children: [] }))
  let agents: any[] = []
  on('agent.list', () => ({ value: agents }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.step', async function* () { return result(11_000, 1_400) as never })

  await $.tool.call({ tool: PLAN, steps: ['Find the page', 'Fix it'] } as never)
  agents = [{ id: 'a1', name: 'scout', description: 'Find the checkout code', type: 'Explore', status: 'running' }]
  for await (const _ of $.turn.step(step('a1', 'claude-haiku-5-5') as never)) { /* drain */ }
  await $.tool.call({ tool: 'Read', file_path: '/src/checkout.ts', agentId: 'a1' } as never)
  await clock.advance(42_000)

  for (const cols of [140, 76]) {
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'clawd-view', surface, ...band(cols) } as never)
      const row = findKey(await ui.drawn(), 'news')
      await ui.unmount()
      const text = flat(row)
      expect(text).toContain(' haiku ')
      expect(text).toContain('scout')
      expect(text).toContain('reading checkout.ts')
      expect(text).toContain('↑ 12.4k')
      expect(text).toContain('42s')
      // One row: the left part truncates, the right part never wraps
      const parts = kids(row)
      expect(parts.length).toBe(2)
      expect(kids(parts[0])[0]?.props?.wrap).toBe('truncate-end')
      expect(parts[1]?.props?.flexShrink).toBe(0)
    }
  }
})

test('A4. a finished agent turns its badge green, a failed one red', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', () => ({ type: 'Box' as const, props: {}, children: [] }))
  let agents: any[] = []
  on('agent.list', () => ({ value: agents }))
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call({ tool: PLAN, steps: ['Find the page', 'Fix it'] } as never)
  // Drawn once before any agent: agents already finished when a job starts are old news
  await (await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band(140) } as never)).unmount()
  for (const [status, mark, color] of [['completed', '✓', '#3fc06a'], ['failed', '✗', '#ff5a36']] as const) {
    agents = [...agents.filter(a => a.status !== 'running'), { id: 'a-' + status, name: 'fixer', description: 'Fix it', type: 'general-purpose', status }]
    await clock.advance(1000)
    const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band(140) } as never)
    const row = findKey(await ui.drawn(), 'news')
    await ui.unmount()
    const withBg = (n: any): any => n?.props?.backgroundColor ? n : kids(n).map(withBg).find(Boolean)
    const badge = withBg(row)
    expect(flat(badge)).toBe(` model ${mark} `)
    expect(badge?.props?.backgroundColor).toBe(color)
  }
})

test('A5. only agents Claude Code lists show: the engine\'s own forks stay out, and every status has a place', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', () => ({ type: 'Box' as const, props: {}, children: [] }))
  let agents: any[] = []
  on('agent.list', () => ({ value: agents }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.step', async function* () { return result(5_000, 100) as never })

  await $.tool.call({ tool: PLAN, steps: ['Find the page', 'Fix it'] } as never)
  // A compaction fork: steps and a tool call under an id no list names
  for await (const _ of $.turn.step(step('fork-1', 'claude-haiku-5-5') as never)) { /* drain */ }
  await $.tool.call({ tool: 'Read', file_path: '/notes.md', agentId: 'fork-1' } as never)
  await clock.advance(5000)
  let ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band(140) } as never)
  expect(findKey(await ui.drawn(), 'news')).toBeUndefined()
  await ui.unmount()

  // Listed agents in each status Claude Code reports all show, the fork still doesn't
  for (const [status, word] of [['pending', 'getting started'], ['running', 'getting started'], ['waiting', 'waiting'], ['idle', 'waiting'], ['completed', 'finished'], ['failed', 'failed'], ['killed', 'stopped']]) {
    agents = [{ id: 'x-' + status, name: 'scout', description: 'Look', type: 'Explore', status }]
    // The line takes turns through every agent: look across a few turns
    let text = ''
    for (let k = 0; k < 8; k++) {
      await clock.advance(5000)
      ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'desktop', ...band(140) } as never)
      text += '|' + flat(findKey(await ui.drawn(), 'news'))
      await ui.unmount()
    }
    expect(text).toContain('scout')
    expect(text).toContain(word)
    expect(text).not.toContain('notes.md')
  }
})
