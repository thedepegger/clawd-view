import { expect, mock, test } from './kit'

import { doingOf, newsItems, pickNews } from '../hooks/clawd-view'

const PLAN = 'mcp__clawd-view__plan_steps'

const band = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 40,
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 39 },
    view: {},
  },
}
const engineBand = () => ({ type: 'Box' as const, props: {}, children: [] })

test('N1. warnings and failures come first, then helpers at work, then finished ones', () => {
  const items = newsItems({
    helpers: [
      { description: 'Search the code', status: 'running', doing: 'reading files' },
      { description: 'Review the page', status: 'completed' },
      { description: 'Test the app', status: 'failed' },
    ],
    files: ['/x/pricing.tsx'],
    limits: [{ kind: 'five_hour', percentUsed: 84 }, { kind: 'seven_day', percentUsed: 30 }],
    contextPct: 40,
    isDone: false,
  })
  expect(items.map(i => `${i.mark} ${i.text}${i.detail ? ` · ${i.detail}` : ''}`)).toEqual([
    '✗ Test the app · failed',
    '⚠ 84% of your 5-hour limit used',
    '◐ Search the code · reading files',
    '✓ Review the page · finished',
  ])
  // Files changed wait for the finished job's summary; several finished helpers are one item
  const two = newsItems({ helpers: [{ description: 'A', status: 'completed' }, { description: 'B', status: 'completed' }], files: [], limits: [], isDone: false })
  expect(two).toEqual([{ mark: '✓', text: '2 helpers finished', isAlert: false }])
})

test('N2. a finished job sums itself up in one line, and nothing at all with no news', () => {
  const done = newsItems({
    helpers: [{ description: 'A', status: 'completed' }, { description: 'B', status: 'completed' }],
    files: ['/a.ts', '/b.ts'],
    limits: [],
    isDone: true,
  })
  expect(done).toEqual([{ mark: '✓', text: 'Changed 2 files · 2 helpers pitched in', isAlert: false }])
  expect(newsItems({ helpers: [], files: [], limits: [], isDone: false })).toEqual([])
})

test('N3. the line moves on every few seconds with dots, and a still box keeps the first item', () => {
  const items = ['a', 'b', 'c'].map(t => ({ mark: '◐', text: t, isAlert: false }))
  expect(pickNews(items, 0, true, 4000)).toEqual({ item: items[0], dots: '● ○ ○' })
  expect(pickNews(items, 4000, true, 4000)).toEqual({ item: items[1], dots: '○ ● ○' })
  expect(pickNews(items, 9000, false, 4000)).toEqual({ item: items[0], dots: '' })
  const many = Array.from({ length: 9 }, (_, k) => ({ mark: '◐', text: String(k), isAlert: false }))
  expect(pickNews(many, 8000, true, 4000)?.dots).toBe('3/9')
  expect(doingOf('Bash')).toBe('running a command')
  expect(doingOf('Agent')).toBe('thinking')
})

test('N4. a helper at work shows in the box, with what it is doing, in the terminal and the desktop app', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  let agents: { id: string; description: string; type: string; status: string }[] = []
  on('agent.list', () => ({ value: agents }))
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call({ tool: PLAN, steps: ['Find the page', 'Fix it'] } as never)
  agents = [{ id: 'a1', description: 'Search the code', type: 'Explore', status: 'running' }]
  await $.tool.call({ tool: 'Grep', pattern: 'plan', agentId: 'a1' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'clawd-view', surface, ...band })
    expect(await ui.find({ type: 'Text', text: /Search the code/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /searching the code/ })).toBeDefined()
  }
})

test('N5. no helpers and no warnings: no news line', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('agent.list', () => ({ value: [] }))

  await $.tool.call({ tool: PLAN, steps: ['Find the page', 'Fix it'] } as never)

  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  expect(await ui.find({ type: 'Text', text: /getting started|pitched in|Changed/ })).toBeUndefined()
})
