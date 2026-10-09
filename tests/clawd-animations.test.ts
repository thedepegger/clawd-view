import { expect, mock, test } from './kit'

// Every animation Clawd has, seen in the band above the prompt: the poses as Claude works,
// and the celebration after

const BAND = {
  plugin: 'clawd-view', surface: 'terminal', component: 'AbovePrompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 115, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
// One frame lasts 150 ms (FRAME_MS)
const FRAME = 150

async function start($: any, on: any) {
  const clock = mock.clock(on)
  mock.env(on, { LANG: 'en_US.UTF-8' })
  mock.store(on, {})
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', () => ({ value: { stdout: '{}', stderr: '', exitCode: 0 } }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }))
  on('command.run', () => ({ text: '' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  return clock
}

const json = (n: unknown) => JSON.stringify(n)
const caption = (t: string) => (t.match(/"((?:Thinking|Reading|Writing code|Editing|Running|Searching|Music mode|Celebration: \w+)[^"]*)"/) || [, ''])[1]
// The mascot's picture alone: the Client's rows of cells
const picture = (t: string) => (t.match(/"rows":(\[.*?\]\]),"columns"|"rows":(\[.*\])/) || [''])[0]

test('each tool Claude uses gets its own pose and caption, and a long answer ends in a celebration', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = await start($, on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__clawd-view__plan_steps', steps: ['Do one', 'Do two'] })
  const seen: string[] = []
  const pictures = new Set<string>()
  for (const tool of ['Read', 'Edit', 'Bash', 'Grep']) {
    await $.tool.call({ tool, file_path: '/x/app.ts', command: 'ls', pattern: 'x' })
    await clock.advance(FRAME * 2)
    await ui.redraw()
    const t = json(await ui.drawn())
    seen.push(caption(t).replace(/\.+/, ''))
    pictures.add(t)
  }
  expect(seen).toEqual(['Reading · app.ts', 'Editing · app.ts', 'Running', 'Searching'])
  // The caption is drawn in Clawd's own orange, never yellow
  const last = [...pictures].pop() as string
  expect(last).toMatch(/"color":"rgb\(217,119,87\)","bold":true/)
  expect(last).not.toContain('"color":"yellow"')
  expect(pictures.size).toBe(4)
  // After 3 seconds with no tool call, back to thinking
  await clock.advance(3500)
  await ui.redraw()
  expect(caption(json(await ui.drawn()))).toMatch(/^Thinking/)
  // A turn of 5 seconds or more ends in a celebration
  await clock.advance(2000)
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 7000, isAborted: false, turnId: 't1' })
  await clock.advance(FRAME)
  await ui.redraw()
  expect(json(await ui.drawn())).toMatch(/"[A-Z][a-z]+( [a-z]+)*!"/)
})
