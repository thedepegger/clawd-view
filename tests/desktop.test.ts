import { expect, mock, test } from './kit'

// The desktop app's Code tab draws the band above the prompt as a card, and draws Svg but loads
// no Client module: the checklist, Clawd's scene, his work poses and the game must all draw there

const BAND = {
  plugin: 'clawd-view', surface: 'desktop', component: 'AbovePrompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 30, bodyColumns: 110, scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
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
  on('process.run', () => ({ value: { stdout: '+0000', stderr: '', exitCode: 0 } }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('ui.focus', () => ({ value: undefined }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }))
  on('command.run', () => ({ text: '' }))
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  return clock
}
const json = (n: unknown) => JSON.stringify(n)

test('desktop: the checklist and Clawd in his scene draw while Claude works, each pose its own', async ($, on) => {
  const clock = await start($, on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__clawd-view__plan_steps', steps: ['Do one', 'Do two'] })
  const svgs = new Set<string>()
  for (const tool of ['Read', 'Edit', 'Bash', 'Grep']) {
    await $.tool.call({ tool, file_path: '/x/app.ts', command: 'ls', pattern: 'x' })
    await clock.advance(FRAME * 2)
    await ui.redraw()
    const t = json(await ui.drawn())
    expect(t).toContain('Do one')
    expect(t).toContain('"type":"Svg"')
    expect(t).not.toContain('"type":"Client"')
    // Clawd's drawing: the Svg that is not one of the card's 11-pixel bars
    const sources: string[] = []
    const walk = (x: any) => {
      if (!x || typeof x !== 'object') return
      if (Array.isArray(x)) return x.forEach(walk)
      if (x.type === 'Svg' && x.props?.height !== 11) sources.push(x.props.source)
      walk(x.children ?? x.props?.children)
    }
    walk(await ui.drawn())
    expect(sources.length).toBeGreaterThan(0)
    svgs.add(sources[0]!)
  }
  expect(svgs.size).toBe(4)
})

test('desktop: idle Clawd draws his city scene, and the game draws with Start and close buttons', async ($, on) => {
  const clock = await start($, on)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: false } })
  await clock.advance(FRAME)
  await ui.redraw()
  const idle = json(await ui.drawn())
  expect(idle).toContain('"type":"Svg"')
  expect(idle).not.toContain('"type":"Client"')
  await $.command.run({ command: 'clawd', args: 'game' })
  await ui.redraw()
  const game = json(await ui.drawn())
  expect(game).toContain('"type":"Button"')
  expect(game).toContain('Clawd game')
  await $.command.run({ command: 'clawd', args: 'game stop' })
  await ui.redraw()
  expect(json(await ui.drawn())).not.toContain('Clawd game')
})

test('desktop: the box shows the full stats under every step, as the terminal does', async ($, on) => {
  const clock = await start($, on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__clawd-view__plan_steps', steps: ['Step one', 'Step two', 'Step three', 'Step four', 'Step five', 'Step six'] })
  await clock.advance(FRAME)
  await ui.redraw()
  const t = json(await ui.drawn())
  for (const step of ['Step one', 'Step six']) expect(t).toContain(step)
  for (const label of ['Model', '5-hour limit', 'Weekly limit', 'Context', 'Cost', 'Session', 'Messages']) expect(t).toContain(label)
})

test('desktop: /clawd-status off hides the stats there too', async ($, on) => {
  const clock = await start($, on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__clawd-view__plan_steps', steps: ['Step one', 'Step two'] })
  await $.command.run({ command: 'clawd-status', args: 'off' })
  await clock.advance(FRAME)
  await ui.redraw()
  const t = json(await ui.drawn())
  expect(t).toContain('Step one')
  expect(t).not.toContain('5-hour limit')
})

test('desktop: every step name sits in a column of one width, so the bars and labels line up', async ($, on) => {
  const clock = await start($, on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__clawd-view__plan_steps', steps: ['Read the feature checklist', 'Write up what I found', 'Check the deed and badge content'] })
  await clock.advance(FRAME)
  await ui.redraw()
  const drawn = await ui.drawn()
  // Each step row: a row Box whose first child is the fixed-width name column
  const rows: any[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    const kids = [].concat(n.children ?? n.props?.children ?? []).flat(Infinity)
    const first: any = kids[0]
    if (n.props?.flexDirection === 'row' && first?.props?.overflow === 'hidden' && typeof first?.props?.width === 'number') rows.push(kids)
    kids.forEach(walk)
  }
  walk(drawn)
  const stepRows = rows.filter(k => /Read the feature|Write up what|Check the deed/.test(JSON.stringify(k[0])))
  expect(stepRows.length).toBe(3)
  // The same name column and the same bar column on every row
  expect(new Set(stepRows.map(k => k[0].props.width)).size).toBe(1)
  expect(new Set(stepRows.map(k => k[1].props.width)).size).toBe(1)
  // The stats labels too: one label width
  const labels = rows.filter(k => /"(Model|5-hour limit|Weekly limit|Context|Cost) *"/.test(JSON.stringify(k[0])))
  expect(labels.length).toBe(5)
  expect(new Set(labels.map(k => k[0].props.width)).size).toBe(1)
})

test('desktop: the session facts (Session, Cache, Input, Output, Messages) sit to the right of the others when the card holds both columns', async ($, on) => {
  const clock = await start($, on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__clawd-view__plan_steps', steps: ['Step one', 'Step two'] })
  await clock.advance(FRAME)
  // 101 cells inside the card: room for both columns with the reset times (97)
  const wide = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 105 } })
  const t = json(await wide.drawn())
  // Side by side: each session fact is a fixed-width box set beside the left column
  for (const label of ['Session', 'Cache', 'Input', 'Output', 'Messages']) {
    expect(t).toMatch(new RegExp('"width":28,"flexShrink":0,"marginLeft":2[^]*?' + label))
  }
  await wide.unmount()
  // A narrower card stacks them in the same label column, never a block wider than the card
  const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 90 } })
  const n = json(await narrow.drawn())
  for (const label of ['Session', 'Cache', 'Input', 'Output', 'Messages']) expect(n).toContain(label)
  expect(n).not.toContain('"width":28,"flexShrink":0,"marginLeft":2')
})

test('desktop: every bar is a solid shape filling its column (no "…"), and the working bar moves like the terminal', async ($, on) => {
  const clock = await start($, on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__clawd-view__plan_steps', steps: ['Look around the project folders', 'Check what is built', 'Write up a short tour'] })
  await $.tool.call({ tool: 'mcp__clawd-view__report_progress', step: 1, percent: 100 })
  await clock.advance(FRAME)
  await ui.redraw()
  // Every bar Svg: 11 pixels tall, as the card draws them (Clawd's scene is taller)
  const barSvgs = (n: any): any[] => {
    const out: any[] = []
    const walk = (x: any) => {
      if (!x || typeof x !== 'object') return
      if (Array.isArray(x)) return x.forEach(walk)
      if (x.type === 'Svg' && x.props?.height === 11) out.push(x.props)
      walk(x.children ?? x.props?.children)
    }
    walk(n)
    return out
  }
  const first = await ui.drawn()
  // No text bars left on the desktop: the step bars and the stats bars are all shapes
  expect(json(first)).not.toContain('▆')
  const bars = barSvgs(first)
  // 3 step bars and 3 stats bars (5-hour, weekly, context)
  expect(bars.length).toBe(6)
  // Each one says what it shows: the desktop app draws nothing for a shape with no description
  for (const b of bars) expect(String(b.alt).length).toBeGreaterThan(0)
  // The step bars all have one width
  const stepWidths = bars.slice(0, 3).map(b => b.width)
  expect(new Set(stepWidths).size).toBe(1)
  // The working bar's wave moves inside its own drawing (no redraw a frame): 2 cells (16 pixels)
  // every 250 ms, a whole 24-cell wave in 3 seconds, so the loop meets its start
  const working = barSvgs(first)[1]
  expect(working.isInteractive).toBe(true)
  expect(working.source).toContain('<animateTransform attributeName="transform" type="translate" values="0 0;16 0;32 0;')
  expect(working.source).toContain(';176 0" dur="3s" calcMode="discrete" repeatCount="indefinite"/>')
  // The done and waiting bars stand still
  expect(barSvgs(first)[0].source).not.toContain('animate')
  expect(barSvgs(first)[2].source).not.toContain('animate')
  await clock.advance(250)
  await ui.redraw()
  expect(barSvgs(await ui.drawn())[1].source).toBe(working.source)
})

test('desktop: a finished job, a stuck one and /clawd-stats all draw cleanly', async ($, on) => {
  const clock = await start($, on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__clawd-view__plan_steps', steps: ['Step one', 'Step two'] })
  await clock.advance(6000)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 6000, isAborted: false, turnId: 't1' })
  await clock.advance(FRAME)
  await ui.redraw()
  const done = json(await ui.drawn())
  expect(done).toContain('All done')
  expect(done).toContain('Done')
  expect(done).not.toContain('▆')
  expect(done).not.toContain('…')
  // A turn that errors leaves the card stuck, still drawn
  await $.turn.start({ text: 'again', turnId: 't2' })
  await $.tool.call({ tool: 'mcp__clawd-view__plan_steps', steps: ['Try again'] })
  await $.turn.complete({ reason: 'error', answer: '', durationMs: 1000, isAborted: false, turnId: 't2' })
  await ui.redraw()
  expect(json(await ui.drawn())).toContain('Try again')
  // /clawd-stats prints a full block in the conversation, its bars shapes too
  const out = await $.command.run({ command: 'clawd-stats', args: '' })
  const printed = await $.ui.mount({
    plugin: 'clawd-view', surface: 'desktop', component: 'CommandOutput',
    viewport: { columns: 120, rows: 40 },
    props: { command: 'clawd-stats', text: out.text },
  } as never)
  const p = json(await printed.drawn())
  expect(p).toContain('Claude stats')
  expect(p).toContain('5-hour limit')
  expect(p).not.toContain('▆')
})

test('desktop side panel: no reset times, so the session column keeps one straight edge; the bottom box keeps them', async ($, on) => {
  const clock = await start($, on)
  // A limit reading with a reset time, as the engine reports one
  await $.session.measure({ context: { window: 1_000_000, percent: 8 }, rateLimits: [{ kind: 'five_hour', percentUsed: 8, resetsAt: '2026-10-09T00:10:00Z' }], changed: ['rateLimits'] } as never)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__clawd-view__plan_steps', steps: ['Summarize what the app is about'] })
  await clock.advance(FRAME)
  const pane = await $.ui.mount({
    plugin: 'clawd-view', surface: 'desktop', component: 'Pane', requestId: 'clawd-view',
    viewport: { columns: 120, rows: 40 },
    props: { title: 'Clawd View', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  const p = json(await pane.drawn())
  expect(p).toContain('5-hour limit')
  expect(p).toContain('8%')
  expect(p).not.toContain('resets')
  for (const label of ['Session', 'Cache', 'Input', 'Output', 'Messages']) expect(p).toContain(label)
  // The session's facts stay on the right in the panel, beside the others
  expect(p).toMatch(/"width":28,"flexShrink":0,"marginLeft":2[^]*?Session/)
  // The bottom box still says when the limit resets
  const band = await $.ui.mount(BAND)
  expect(json(await band.drawn())).toContain('resets')
})
