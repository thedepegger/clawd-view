import { expect, mock, test } from './kit'

import { applyProgress, planFrom } from '../hooks/clawd-view'

// Regression tests for the checklist logic: each one was a reviewer's repro of a bug (R1 to R11)
// or a release fix, and now asserts the fixed behaviour.

const PLAN = 'mcp__clawd-view__plan_steps'
const PROGRESS = 'mcp__clawd-view__report_progress'
const band = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 60, bodyColumns: 140, scroll: { offset: 0, bodyRows: 59 }, view: {} },
}
const engineBand = () => ({ type: 'Box' as const, props: {}, children: [] })
const flat = (n: any): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n)
    : Array.isArray(n) ? n.map(flat).join('|')
    : n && typeof n === 'object' ? flat(n.children ?? n.props?.children) : ''
async function draw($: any): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'clawd-view', surface: 'terminal', ...band })
  const t = flat(await ui.drawn())
  await ui.unmount()
  return t.replace(/\|+/g, '|')
}
const SAID_NO = "The user doesn't want to proceed with this tool use. The tool use was rejected"
const compose = (surfaces: string[], tools: string[]) =>
  ({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces, tools, outputStyle: null, traits: [] }) as never
const steps = (list: { name: string; status: string }[]) => list.map(t => `${t.name}:${t.status}`)

test('L1. an approved tool that runs a long time stops showing Needs you once it runs (R1)', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('classic.Notification', () => ({}))
  let asked = ''
  let running = ''
  on('tool.call', { tool: 'Bash' }, async () => {
    // The permission prompt fires, the person approves, then the command runs and its progress row shows
    await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
    asked = await draw($)
    const row = await $.ui.mount({
      plugin: 'clawd-view', surface: 'terminal', component: 'ToolProgress',
      props: { tool_use_id: 'toolu_1', kind: 'background_hint', hint: '(ctrl+b to run in background)' },
    } as never)
    await row.drawn()
    await row.unmount()
    await clock.advance(10)
    running = await draw($)
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  await $.tool.call({ tool: PLAN, steps: ['Build the page', 'Check it'] } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  expect(asked).toContain('Needs you')
  expect(running).not.toContain('Needs you')
  expect(running).toContain('Build the page')
})

test('L2. a near-miss step name updates the planned step instead of adding one (R2)', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  await $.tool.call({ tool: PROGRESS, task: 'build pricing section!', percent: 50 } as never)
  const t = await draw($)
  expect(t).toContain('Step 1 of 2')
  expect(t).not.toContain('of 3')

  const plan = planFrom(['Build the pricing section', 'Add the contact form'])
  // A prefix of a planned name is that step too
  expect(steps(applyProgress(plan, 'Add the contact form and its button', 100))).toEqual([
    'Build the pricing section:done', 'Add the contact form:done',
  ])
  // A short, vague name is not matched inside another step's name; a new one is added
  expect(applyProgress(plan, 'Add', 10).length).toBe(3)
  expect(steps(applyProgress(planFrom(['Check it works', 'Ship it']), 'Check it', 10))).toEqual([
    'Check it:active', 'Check it works:upcoming', 'Ship it:upcoming',
  ])
  // The closest name wins: equal once loosened beats one name being part of another
  expect(steps(applyProgress(planFrom(['Build the page', 'Build the page footer']), 'Build page footer', 100))).toEqual([
    'Build the page:done', 'Build the page footer:done',
  ])
  // Added steps are capped: past three, a new name counts toward the step being worked on
  let list = plan
  for (const name of ['Tidy up one', 'Tidy up two', 'Tidy up three', 'Tidy up four', 'Tidy up five']) list = applyProgress(list, name, 10)
  expect(list.length).toBe(5)
})

test('L3. two steps with the same name: the second is ticked by name, not the first again (R3)', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  let list = planFrom(['Run the checks', 'Fix the page', 'Run the checks'])
  list = applyProgress(list, 'Run the checks', 100)
  list = applyProgress(list, 'Fix the page', 100)
  list = applyProgress(list, 'Run the checks', 100)
  expect(list.map(t => t.status)).toEqual(['done', 'done', 'done'])
  // The same through the tools
  await $.tool.call({ tool: PLAN, steps: ['Run the checks', 'Fix the page', 'Run the checks'] } as never)
  await $.tool.call({ tool: PROGRESS, task: 'Run the checks', percent: 100 } as never)
  await $.tool.call({ tool: PROGRESS, task: 'Fix the page', percent: 100 } as never)
  await $.tool.call({ tool: PROGRESS, task: 'Run the checks', percent: 50 } as never)
  const t = await draw($)
  expect(t).toContain('Step 3 of 3')
  expect(t).toContain('50%')
})

test('L4. a nameless report lands on the active step, never on a step called "Working on it" (R4)', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['`npm install`', 'Build the page', 'Check it'] } as never)
  await $.tool.call({ tool: PROGRESS, step: 1, percent: 100 } as never)
  await $.tool.call({ tool: PROGRESS, step: 2, percent: 100 } as never)
  await $.tool.call({ tool: PROGRESS, percent: 30 } as never)
  const t = await draw($)
  expect(t).toContain('Step 3 of 3')
  expect(t).not.toContain('Step 1 of 3')
  // A name that is all code counts as no name too
  const list = applyProgress(applyProgress(planFrom(['`npm install`', 'Build the page']), '1', 100), '`npm test`', 40)
  expect(steps(list)).toEqual(['Working on it:done', 'Build the page:active'])
  expect(list[1]!.percent).toBe(40)
})

test('L5. saying No to a permission ends saying so, not "you pressed Esc" (R5)', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: SAID_NO }) as never)
  await $.turn.start({ text: 'Build it', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the page', 'Check it'] } as never)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await $.turn.complete({ reason: 'aborted', answer: '', durationMs: 10, isAborted: true, turnId: 't1' } as never)
  const t = await draw($)
  expect(t).not.toContain('you pressed Esc')
  expect(t).toContain('you said no to a step, so Claude stopped there')
  // A real Esc still reads as one
  await $.turn.start({ text: 'Build it again', turnId: 't2' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the page', 'Check it'] } as never)
  await $.turn.complete({ reason: 'aborted', answer: '', durationMs: 10, isAborted: true, turnId: 't2' } as never)
  expect(await draw($)).toContain('you pressed Esc')
})

test('L6. the gate gives up after two denials, and to-do tools or a missing plan tool never leave it stuck (R6)', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('prompt.compose', () => ({ sections: [] }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'ok' }) as never)
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
  on('tool.call', { tool: 'TaskUpdate' }, () => ({ result: { success: true, taskId: '3', updatedFields: ['status'] } }) as never)
  const denials = async () => {
    let denied = 0
    for (let i = 0; i < 5; i++) if ((await $.tool.call({ tool: 'Read', file_path: '/tmp/x' } as never)).deny !== undefined) denied++
    return denied
  }
  await $.prompt.compose(compose(['terminal'], [PLAN, 'Read', 'ToolSearch']))
  // No plan at all: two denials, then the gate lets the turn go on
  await $.turn.start({ text: 'What is in this folder?', turnId: 't1' } as never)
  const first = await $.tool.call({ tool: 'Read', file_path: '/tmp/x' } as never)
  expect(first.deny).toContain('1 to 8')
  expect(await denials()).toBe(1)
  // An empty to-do list counts as Claude's plan
  await $.turn.start({ text: 'And this one?', turnId: 't2' } as never)
  await $.tool.call({ tool: 'TodoWrite', todos: [] } as never)
  expect(await denials()).toBe(0)
  // So does an update to an existing task
  await $.turn.start({ text: 'And that one?', turnId: 't3' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'in_progress' } as never)
  expect(await denials()).toBe(0)
  // A request that cannot reach plan_steps is never gated
  await $.prompt.compose(compose(['terminal'], ['Read', 'Bash']))
  await $.turn.start({ text: 'One more?', turnId: 't4' } as never)
  expect(await denials()).toBe(0)
  // An empty plan is refused with the right range
  expect((await $.tool.call({ tool: PLAN, steps: [] } as never)).deny).toBe('plan_steps needs 1 to 8 step names.')
  // The plan tool is offered again, so no later test starts with the gate off
  await $.prompt.compose(compose(['terminal'], [PLAN]))
})

test('L7. TaskCreate never starts a task Claude has not started (R7)', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  let n = 0
  on('tool.call', { tool: 'TaskCreate' }, () => ({ result: { task: { id: String(++n), subject: 'x' } } }) as never)
  on('tool.call', { tool: 'TaskUpdate' }, (_: unknown, e: any) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }) as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Read the notes', description: '' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Build the page', description: '' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' } as never)
  const t = await draw($)
  // Only the task Claude marked in progress is worked on
  expect(t).toContain('Step 2 of 2')
  expect(t).not.toContain('Step 1 of 2')
})

test('L8. a slash command typed during a background turn leaves the finished card alone (R9)', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  let titled = 0
  on('model.complete', () => {
    titled++
    return { value: { isAnswered: true, text: 'Do a thing' } }
  })
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  // The first job's own title has been asked for
  await clock.advance(10)
  const before = titled
  await $.turn.start({ text: '<task-notification>agent finished</task-notification>', turnId: 't2' } as never)
  await $.prompt.submit({ text: '/clawd-view help', wait: false, turnId: 't2', origin: { kind: 'composer' } } as never)
  await clock.advance(10)
  const t = await draw($)
  expect(t).toContain('Build the pricing section')
  expect(t).toContain('All done')
  expect(titled).toBe(before)
})

test('L9. saying No to a step, then Claude replying, never reads All done (R10)', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  let refuse = true
  on('tool.call', { tool: 'Bash' }, () =>
    (refuse ? { isError: true, result: undefined, text: SAID_NO } : { result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
  await $.turn.start({ text: 'Clean up the old files', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Find the old files', 'Delete them', 'Check the result'] } as never)
  await $.tool.call({ tool: PROGRESS, step: 1, percent: 100 } as never)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf old' })
  await $.turn.complete({ reason: 'answer', answer: "OK, I won't delete them.", durationMs: 10, isAborted: false, turnId: 't1' } as never)
  let t = await draw($)
  expect(t).not.toContain('All done')
  expect(t).toContain('you said no to a step, so Claude stopped there')
  // The steps left are not ticked: the card still points at step 2
  expect(t).toContain('Step 2 of 3')
  // Even when a later tool ran fine, a refusal with steps left never ends as All done
  await $.turn.start({ text: 'Clean up again', turnId: 't2' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Find the old files', 'Delete them'] } as never)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf old' })
  refuse = false
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete({ reason: 'answer', answer: 'Left them.', durationMs: 10, isAborted: false, turnId: 't2' } as never)
  t = await draw($)
  expect(t).not.toContain('All done')
  // A refusal after which every step was finished another way is All done
  await $.turn.start({ text: 'Clean up once more', turnId: 't3' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Find the old files'] } as never)
  refuse = true
  await $.tool.call({ tool: 'Bash', command: 'rm -rf old' })
  await $.tool.call({ tool: PROGRESS, step: 1, percent: 100 } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done another way.', durationMs: 10, isAborted: false, turnId: 't3' } as never)
  expect(await draw($)).toContain('All done')
})

test('L10. a sub-100 report on a finished step never un-ticks it (R11)', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  await $.tool.call({ tool: PLAN, steps: ['Read the notes', 'Build the page', 'Check it'] } as never)
  await $.tool.call({ tool: PROGRESS, step: 1, percent: 100 } as never)
  await $.tool.call({ tool: PROGRESS, step: 2, percent: 100 } as never)
  await $.tool.call({ tool: PROGRESS, step: 1, percent: 90 } as never)
  await $.tool.call({ tool: PROGRESS, task: 'Build the page', percent: 20 } as never)
  const t = await draw($)
  expect(t).toContain('Step 3 of 3')
  expect(t).not.toContain('Step 1 of 3')
})

test('L11. the plan instructions and the gate are only for a person at a screen with the plan tool', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('prompt.compose', () => ({ sections: [] }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  const ids = (r: any) => (r.sections as { id: string }[]).map(s => s.id)
  const shown: any = await $.prompt.compose(compose(['terminal'], [PLAN, 'Bash']))
  expect(ids(shown)).toContain('clawd-view:plain-steps')
  const section = shown.sections.find((s: any) => s.id === 'clawd-view:plain-steps').text as string
  // The person's preference, not a claim about them
  expect(section).not.toContain('not technical')
  expect(section).toContain('prefers to follow your progress in plain English')
  // Deferred: reachable through ToolSearch
  expect(ids(await $.prompt.compose(compose(['terminal'], ['ToolSearch', 'Bash'])))).toContain('clawd-view:plain-steps')
  // No plan tool in the request
  expect(ids(await $.prompt.compose(compose(['terminal'], ['Bash'])))).not.toContain('clawd-view:plain-steps')
  // Nothing draws: a `-p` run or the SDK, and it is never gated
  expect(ids(await $.prompt.compose(compose([], [PLAN, 'Bash'])))).not.toContain('clawd-view:plain-steps')
  await $.turn.start({ text: 'Summarise the readme', turnId: 't1' } as never)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  // The plan tool is offered again, so no later test starts with the gate off
  await $.prompt.compose(compose(['terminal'], [PLAN]))
})

// Keep this test after every test that needs the gate or a Haiku title: a session that started
// non-interactive stays that way until the next session.start
test('L12. a non-interactive session gets no plan instructions, no gate and no Haiku title', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'sid-1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: [] } }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', () => ({ value: { stdout: '{}', stderr: '', exitCode: 0 } }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('prompt.compose', () => ({ sections: [] }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  let titled = 0
  on('model.complete', () => {
    titled++
    return { value: { isAnswered: true, text: 'Summarise it' } }
  })
  await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false } as never)
  const composed: any = await $.prompt.compose(compose(['terminal'], [PLAN, 'Bash']))
  expect((composed.sections as { id: string }[]).map(s => s.id)).not.toContain('clawd-view:plain-steps')
  await $.turn.start({ text: 'Summarise the readme', turnId: 't1' } as never)
  await clock.advance(10)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  expect(titled).toBe(0)
})

test('L13. a failed plan_steps hook tells the model to try again instead of "Noted."', async ($, on) => {
  // No clock answers, so starting the job fails part way and no plan is stored
  mock.store(on)
  const planned: any = await $.tool.call({ tool: PLAN, steps: ['Build the page'] } as never)
  expect(planned.result).toBeUndefined()
  expect(planned.deny).toBe('Clawd View could not save the plan just now. Call plan_steps again.')
})

test('L14. which turn is a background one lives in plugin state, so a reload keeps it', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  // Every write of the flag, as the host stores it
  const written: unknown[] = []
  on('state.set', (_: unknown, e: any, next: any) => {
    if (e.plugin === 'clawd-view' && e.key === 'isBackgroundTurn') written.push(e.value)
    return next(e)
  })
  await $.turn.start({ text: 'Build the page', turnId: 't1' } as never)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section'] } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await $.turn.start({ text: '<task-notification>agent finished</task-notification>', turnId: 't2' } as never)
  expect(written).toEqual([true])
  // A plan in the background turn leaves the finished card as it was
  await $.tool.call({ tool: PLAN, steps: ['Check the agent'] } as never)
  const t = await draw($)
  expect(t).toContain('Build the pricing section')
  expect(t).not.toContain('Check the agent')
})

test('L15. bad report and plan inputs never throw, and bad plans are refused with the right range (R8)', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', engineBand)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'Do it', turnId: 't1' } as never)
  // Reports before any plan leave the card's placeholder steps alone
  expect((await $.tool.call({ tool: PROGRESS, percent: 150, step: 99 } as never)).result).toBe('Progress noted: 100%.')
  expect((await $.tool.call({ tool: PROGRESS, percent: 'abc', task: 42 } as never)).result).toBe('Progress noted: 0%.')
  let t = await draw($)
  expect(t).toContain('Understand your request')
  // A long plan keeps its first 8 steps
  const long: any = await $.tool.call({ tool: PLAN, steps: Array.from({ length: 20 }, (_, i) => `Step number ${i + 1}`) } as never)
  expect(long.result).toBe('Planned 8 steps. The first one has started.')
  for (const bad of [{ steps: [] }, { steps: 'not an array' }, {}]) {
    expect((await $.tool.call({ tool: PLAN, ...bad } as never)).deny).toContain('1 to 8')
  }
  t = await draw($)
  expect(t).toContain('Step 1 of 8')
})
