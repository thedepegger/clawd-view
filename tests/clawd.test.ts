import { expect, mock, test } from './kit'

// What Claude Code passes to the band's ui.render hook, apart from the app
const BAND = {
  plugin: 'clawd-view',
  surface: 'terminal',
  component: 'AbovePrompt',
  // A terminal tall enough for the mascot (it steps aside below 26 rows on the main screen)
  viewport: { columns: 100, rows: 40 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 15,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 15 },
    view: {},
  },
} as const

// One frame lasts 150 ms (FRAME_MS)
const FRAME = 150

// Start a session the way Claude Code does, with every call the mod makes answered
async function start($, on) {
  const clock = mock.clock(on)
  mock.env(on, { LANG: 'zh_CN.UTF-8' })
  mock.store(on, {})
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  // What Claude Code draws in the band when the mod draws nothing there
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['nothing of ours'] }))
  on('command.run', () => ({ text: '' }))
  // What Clawd View, in the same mod, asks for as the session starts
  on('tool.register', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'sid-clawd' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', () => ({ value: { stdout: '{}', stderr: '', exitCode: 0 } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  return clock
}

// The rows of quadrant characters the mascot's Client draws, top to bottom
async function picture(ui) {
  const rows = await ui.findAll({ type: 'Box', in: 'clawd' })
  const texts = []
  for (const row of rows.slice(1)) texts.push(JSON.stringify(row))
  return texts.join('\n')
}

test('a click makes the mascot hop, wink and look around, then settle', async ($, on) => {
  const clock = await start($, on)
  const ui = await $.ui.mount(BAND)
  const resting = await picture(ui)
  expect(resting).toContain('▄')

  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left', in: 'clawd' })
  const hopping = await picture(ui)
  expect(hopping).not.toBe(resting)

  // Partway through, still not at rest
  await clock.advance(FRAME * 5)
  expect(await picture(ui)).not.toBe(resting)

  // The whole reaction is 26 frames; one frame more and it's back as it was
  await clock.advance(FRAME * 22)
  expect(await picture(ui)).toBe(resting)
})

test('a right click does nothing', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount(BAND)
  const resting = await picture(ui)
  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'right', in: 'clawd' })
  expect(await picture(ui)).toBe(resting)
})

test('/clawd hidden empties the band and show brings the mascot back', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Client' })).toBeDefined()

  const hidden = await $.command.run({ command: 'clawd', args: 'hidden' })
  expect(hidden.text).toContain('隐藏')
  await ui.redraw()
  expect(await ui.find({ type: 'Client' })).toBeUndefined()

  await $.command.run({ command: 'clawd', args: 'show' })
  await ui.redraw()
  expect(await ui.find({ type: 'Client' })).toBeDefined()
})

test('/clawd idle with a pastime Clawd does not know says which ones he does', async ($, on) => {
  await start($, on)
  const bad = await $.command.run({ command: 'clawd', args: 'idle juggling' })
  expect(bad.text).toContain('juggling')
  expect(bad.text).toContain('fishing')
})

test('/clawd chat answers in the pane and keeps the chat out of the command output', async ($, on) => {
  // The engine's hooks go in before the test first calls $
  on('session.messages', () => ({ value: [{ role: 'user', text: 'fix the tests', toolUses: [] }] }))
  on('model.complete', ($, e) => ({
    value: { isAnswered: true, text: 'Go get them!', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({ value: {} }))
  await start($, on)
  const answer = await $.command.run({ command: 'clawd', args: 'chat hello Clawd' })
  // Nothing of the chat goes into the transcript
  expect(answer.text).toBeUndefined()
  const pane = await $.ui.mount({
    plugin: 'clawd-view',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'clawd-chat',
    viewport: { columns: 100, rows: 30 },
    props: { title: 'Clawd', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect(await pane.find({ type: 'Text', text: 'hello Clawd' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Go get them!' })).toBeDefined()
  expect(await pane.find({ key: 'clawd-chat-input' })).toBeDefined()
})

// The mascot's height on screen: its Client's set height
async function mascotRows(ui) {
  const drawn = await ui.drawn()
  let found = 0
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    const p = n.props ?? {}
    if (typeof p.height === 'number' && (n.key === 'clawd' || p.key === 'clawd' || p.module === './clawd-view.js')) found = p.height
    const c = n.children ?? p.children
    if (c) walk(c)
  }
  walk(drawn)
  return found
}

test('the mascot keeps one height between turns and in fullscreen, and stays while Claude works on the main screen', async ($, on) => {
  const clock = await start($, on)
  const idle = await $.ui.mount(BAND)
  const resting = await mascotRows(idle)
  await idle.unmount()
  expect(resting).toBe(5)
  // Main screen, Claude working: Clawd stays, at the same height
  const busy = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true } })
  await clock.advance(FRAME * 3)
  expect(await mascotRows(busy)).toBe(resting)
  await busy.unmount()
  // Fullscreen keeps him while working, at the same height
  const full = await $.ui.mount({ ...BAND, viewport: { columns: 100, rows: 40, isFullscreen: true }, props: { ...BAND.props, isWorking: true } })
  await clock.advance(FRAME * 3)
  expect(await mascotRows(full)).toBe(resting)
  await full.unmount()
})

test('on the main screen the mascot steps aside in a short terminal, never in fullscreen', async ($, on) => {
  await start($, on)
  const short = await $.ui.mount({ ...BAND, viewport: { columns: 100, rows: 20 } })
  expect(await mascotRows(short)).toBe(0)
  await short.unmount()
  const tall = await $.ui.mount({ ...BAND, viewport: { columns: 100, rows: 40 } })
  expect(await mascotRows(tall)).toBe(5)
  await tall.unmount()
  const full = await $.ui.mount({ ...BAND, viewport: { columns: 100, rows: 31, isFullscreen: true } })
  expect(await mascotRows(full)).toBe(5)
  await full.unmount()
})

test('on the main screen game mode also steps aside in a short terminal, never in fullscreen', async ($, on) => {
  await start($, on)
  await $.command.run({ command: 'clawd', args: 'game' } as never)
  const short = await $.ui.mount({ ...BAND, viewport: { columns: 100, rows: 20 } })
  expect(JSON.stringify(await short.drawn())).not.toContain('clawd-game')
  await short.unmount()
  const tall = await $.ui.mount({ ...BAND, viewport: { columns: 100, rows: 40 } })
  expect(JSON.stringify(await tall.drawn())).toContain('clawd-game')
  await tall.unmount()
  const full = await $.ui.mount({ ...BAND, viewport: { columns: 100, rows: 31, isFullscreen: true } })
  expect(JSON.stringify(await full.drawn())).toContain('clawd-game')
  await full.unmount()
})

test('a usual 31-row window keeps the mascot on the main screen', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, viewport: { columns: 115, rows: 31 } })
  expect(await mascotRows(ui)).toBeGreaterThan(0)
  await ui.unmount()
})
