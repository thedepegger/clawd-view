import { expect, mock, test } from './kit'

// The plan gate rests once the model has twice been unable to plan (plan_steps denied by a rule, a
// restricted tool set), so no later request pays two wasted tool calls, and wakes when a plan arrives

const PLAN = 'mcp__clawd-view__plan_steps'
const engineBand = () => ({ type: 'Box' as const, props: {}, children: [] })
const compose = (surfaces: string[], tools: string[]) =>
  ({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces, tools, outputStyle: null, traits: [] }) as never

test('G1. after two turns that gave up with no plan the gate rests, and a plan wakes it', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('prompt.compose', () => ({ sections: [] }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'ok' }) as never)
  const denials = async () => {
    let denied = 0
    for (let i = 0; i < 4; i++) if ((await $.tool.call({ tool: 'Read', file_path: '/tmp/x' } as never)).deny !== undefined) denied++
    return denied
  }
  const turn = async (id: string) => {
    await $.turn.start({ text: `Request ${id}`, turnId: id } as never)
    const denied = await denials()
    return { denied, end: () => $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1000, isAborted: false, turnId: id } as never) }
  }
  await $.prompt.compose(compose(['terminal'], ['Read', 'ToolSearch']))
  const one = await turn('t1')
  expect(one.denied).toBe(2)
  await one.end()
  const two = await turn('t2')
  expect(two.denied).toBe(2)
  await two.end()
  // Resting: nothing is turned away
  const three = await turn('t3')
  expect(three.denied).toBe(0)
  // A plan made after all: the gate is back for the next request
  await $.tool.call({ tool: PLAN, steps: ['Look around'] } as never)
  await three.end()
  const four = await turn('t4')
  expect(four.denied).toBe(2)
})
