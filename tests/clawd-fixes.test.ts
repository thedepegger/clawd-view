import { expect, mock, test } from './kit'
// @ts-expect-error the mascot is plain JavaScript, with no types of its own
import { register } from '../hooks/clawd.js'

// Fixes found in review before the first release: the party only after an answer, the desktop
// card drawn again only when it changes, the game and music mode kept honest, and the replies
// that say what happened

const TBAND = {
  plugin: 'clawd-view', surface: 'terminal', component: 'AbovePrompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 115, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const DBAND = {
  plugin: 'clawd-view', surface: 'desktop', component: 'AbovePrompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 110, scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const FRAME = 150

type Options = {
  surface?: 'terminal' | 'desktop'
  // Answers process.run: argv in, the result out (or a throw)
  run?: (argv: string[]) => { stdout: string; stderr: string; exitCode: number }
  // The listening program: says it's listening at once, after a moment (a fraction of a second
  // of real time, while the test moves the clock on), or never
  ears?: 'ok' | 'late' | 'silent'
  config?: boolean
}

// Start a session with every call the mod makes answered. Counts the band's drawings (each one
// reaches the engine's own band last) and keeps every toast and process run.
async function start($: any, on: any, o: Options = {}) {
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
  const runs: string[][] = []
  on('process.run', (_: unknown, e: any) => {
    const argv = (e.argv || e) as string[]
    runs.push(argv)
    return { value: o.run ? o.run(argv) : { stdout: '+0000', stderr: '', exitCode: 0 } }
  })
  const ears = { killed: false }
  on('process.spawn', async function* () {
    try {
      if (o.ears === 'late') await new Promise((r) => setTimeout(r, 1500))
      if (o.ears !== 'silent') yield { stream: 'stdout', text: 'ok\n' }
      while (true) {
        await new Promise((r) => setTimeout(r, 20))
        yield o.ears === 'silent' ? { stream: 'stderr', text: 'waiting\n' } : { stream: 'stdout', text: '0 0\n' }
      }
    } finally {
      ears.killed = true
    }
  })
  const band = { renders: 0 }
  on('ui.render', (_: unknown, e: any) => {
    if (e.component === 'AbovePrompt') band.renders++
    return { type: 'Box', props: {}, children: [] }
  })
  on('ui.focus', () => ({ value: undefined }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('turn.abort', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'ok' }))
  on('command.run', () => ({ text: '' }))
  on('prompt.edit', (_: unknown, e: any) => ({ text: e.text + e.inputText, cursor: e.start + e.inputText.length }))
  if (o.config) {
    on('config.list', () => ({ value: [{ key: 'clawd-view@clawd-view.chatModel', value: 'haiku' }, { key: 'clawd-view@clawd-view.chatEffort', value: 'default' }] }))
    on('config.set', (_: unknown, e: any) => ({ value: e.value }))
  }
  const toasts: string[] = []
  on('ui.toast', (_: unknown, e: any) => {
    toasts.push(String(e.text ?? e.message ?? JSON.stringify(e)))
    return { value: undefined }
  })
  await $.session.start({ surface: o.surface ?? 'terminal', isInteractive: true, cwd: '/work' })
  // The checklist's card has a clock of its own while a job runs; these tests are about Clawd's
  await $.command.run({ command: 'clawd-view', args: 'off' })
  return { clock, toasts, runs, ears, band }
}
const json = (n: unknown) => JSON.stringify(n)
const clawd = (args: string) => ({ command: 'clawd', args })
const reply = async ($: any, args: string) => String((await $.command.run(clawd(args)))?.text ?? '')
// The Svg sources in a drawing
const sources = (drawn: unknown) => [...json(drawn).matchAll(/"source":"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse('"' + m[1] + '"') as string)
const CHEER = /All done!|Nailed it!|Great job!|Awesome!/

test('1. a long turn stopped with Esc, refused or failed gets no party; one that answered does', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock } = await start($, on)
  const ui = await $.ui.mount(TBAND)
  for (const reason of ['aborted', 'error', 'refusal'] as const) {
    await $.turn.start({ text: 'go', turnId: 't-' + reason })
    await clock.advance(6000)
    await $.turn.complete({ reason, answer: '', turnId: 't-' + reason } as any)
    await clock.advance(FRAME)
    await ui.redraw()
    expect(json(await ui.drawn())).not.toMatch(CHEER)
  }
  await $.turn.start({ text: 'go', turnId: 't-answer' })
  await clock.advance(6000)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't-answer' } as any)
  await clock.advance(FRAME)
  await ui.redraw()
  expect(json(await ui.drawn())).toMatch(CHEER)
})

test('2a. desktop: a working turn draws the card a few times, not every frame, and Clawd moves by himself', { timeoutMs: 60_000 }, async ($, on) => {
  const { clock, band } = await start($, on, { surface: 'desktop' })
  const ui = await $.ui.mount(DBAND)
  await $.turn.start({ text: '', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/x/app.ts' })
  await clock.advance(FRAME)
  const first = sources(await ui.drawn()).join('')
  // The pose's frames are in the drawing, played by its own animation
  expect(first).toContain('calcMode="discrete"')
  band.renders = 0
  // Six seconds: the Read pose goes back to thinking once, after three
  for (let i = 0; i < 40; i++) await clock.advance(FRAME)
  expect(band.renders).toBeGreaterThan(0)
  expect(band.renders).toBeLessThanOrEqual(3)
  // Every drawing fits in what the app takes for an Svg, every pose and the party alike
  for (const tool of ['Edit', 'Bash', 'Grep', 'Read']) {
    await $.tool.call({ tool, file_path: '/x/app.ts', command: 'ls', pattern: 'x' })
    await clock.advance(FRAME)
    for (const s of sources(await ui.drawn())) expect(s.length).toBeLessThan(131072)
  }
  await clock.advance(6000)
  for (const s of sources(await ui.drawn())) expect(s.length).toBeLessThan(131072)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1' } as any)
  await clock.advance(FRAME)
  const party = json(await ui.drawn())
  expect(party).toMatch(CHEER)
  for (const s of sources(await ui.drawn())) expect(s.length).toBeLessThan(131072)
  // The party plays out by itself, and one more drawing ends it
  band.renders = 0
  for (let i = 0; i < 40; i++) await clock.advance(FRAME)
  expect(band.renders).toBeLessThanOrEqual(2)
  expect(json(await ui.drawn())).not.toMatch(CHEER)
})

test('2b. desktop without the scene: Clawd is a flip-book too, and the card stays still', async ($, on) => {
  const { clock, band } = await start($, on, { surface: 'desktop' })
  await $.command.run(clawd('scene off'))
  const ui = await $.ui.mount(DBAND)
  await $.turn.start({ text: '', turnId: 't1' })
  await clock.advance(FRAME)
  expect(sources(await ui.drawn()).join('')).toContain('calcMode="discrete"')
  expect(json(await ui.drawn())).toContain('Thinking…')
  band.renders = 0
  for (let i = 0; i < 30; i++) await clock.advance(FRAME)
  expect(band.renders).toBe(0)
})

test('2c. the terminal still draws every frame while Claude works', async ($, on) => {
  const { clock, band } = await start($, on)
  await $.ui.mount(TBAND)
  await $.turn.start({ text: '', turnId: 't1' })
  band.renders = 0
  for (let i = 0; i < 20; i++) await clock.advance(FRAME)
  expect(band.renders).toBeGreaterThanOrEqual(15)
})

test("2d. desktop game: Start, Jump, Pause and the ✕ all work, and a run isn't redrawn every frame", { timeoutMs: 60_000 }, async ($, on) => {
  const { clock, band } = await start($, on, { surface: 'desktop' })
  const ui = await $.ui.mount(DBAND)
  expect(await reply($, 'game')).toContain('✕')
  await ui.redraw()
  expect(json(await ui.find({ key: 'clawd-main' }))).toContain('Start')
  await ui.press({ key: 'clawd-main' })
  await clock.advance(FRAME)
  expect(json(await ui.find({ key: 'clawd-main' }))).toContain('Jump')
  band.renders = 0
  for (let i = 0; i < 10; i++) await clock.advance(100)
  // A second of running: hardly a drawing is needed, unless a crash comes
  expect(band.renders).toBeLessThanOrEqual(2)
  await ui.press({ key: 'clawd-main' })
  await ui.press({ key: 'clawd-pause' })
  expect(json(await ui.find({ key: 'clawd-pause' }))).toContain('Resume')
  await ui.press({ key: 'clawd-pause' })
  expect(json(await ui.find({ key: 'clawd-pause' }))).toContain('Pause')
  await ui.press({ key: 'clawd-close' })
  expect(json(await ui.drawn())).not.toContain('Clawd game')
  // Put away, the game's timer is gone: nothing draws the card again
  band.renders = 0
  for (let i = 0; i < 20; i++) await clock.advance(FRAME)
  expect(band.renders).toBe(0)
})

test('3. a paused desktop game stays up past a minute; Pause and Resume count as play', { timeoutMs: 60_000 }, async ($, on) => {
  const { clock, toasts } = await start($, on, { surface: 'desktop' })
  const ui = await $.ui.mount(DBAND)
  await $.command.run(clawd('game'))
  await ui.press({ key: 'clawd-main' })
  await clock.advance(1000)
  await ui.press({ key: 'clawd-pause' })
  for (let i = 0; i < 9; i++) await clock.advance(10_000)
  await ui.redraw()
  expect(json(await ui.drawn())).toContain('clawd-main')
  expect(toasts.join(' ')).not.toContain('Nobody played')
  // Resumed, it has a full minute again before it's put away
  await ui.press({ key: 'clawd-pause' })
  for (let i = 0; i < 5; i++) await clock.advance(10_000)
  await ui.redraw()
  expect(json(await ui.drawn())).toContain('clawd-main')
})

test('4. /clawd scene with a word it does not know says so, and changes nothing', async ($, on) => {
  await start($, on)
  const text = await reply($, 'scene bogus')
  expect(text).toContain('No such option "bogus"')
  expect(text).toContain('morning')
  expect(await reply($, 'scene dusk')).toContain('Scene: dusk')
  expect(await reply($, 'scene')).toContain('Scene: dusk')
})

test('5. a band drawn with no viewport keeps the mascot, however few rows the band has', async ($, on) => {
  await start($, on)
  const { viewport, ...noViewport } = TBAND as any
  const ui = await $.ui.mount(noViewport)
  expect(await ui.find({ key: 'clawd' })).not.toBeUndefined()
})

test('6a. music mode off a Mac says so plainly, and builds nothing', async ($, on) => {
  const { toasts, runs } = await start($, on, {
    run: (argv) => {
      if (argv[0] === '/usr/bin/sw_vers') throw new Error('spawn /usr/bin/sw_vers ENOENT')
      return { stdout: '+0000', stderr: '', exitCode: 0 }
    },
  })
  expect(await reply($, 'music start')).toBe('Music mode works only on a Mac.')
  expect(toasts.join(' ')).not.toContain('building')
  expect(runs.some((argv) => argv[0] === '/usr/bin/xcrun')).toBe(false)
})

test("6b. music mode without Apple's command line tools says how to get them, and never runs xcrun", async ($, on) => {
  const { toasts, runs } = await start($, on, {
    run: (argv) => {
      // Not built yet, and xcode-select finds no developer tools
      if (argv[0] === '/bin/test' && argv[2] === '-nt') return { stdout: '', stderr: '', exitCode: 1 }
      if (argv[0] === '/usr/bin/xcode-select') return { stdout: '', stderr: 'error: unable to get active developer directory', exitCode: 2 }
      return { stdout: '+0000', stderr: '', exitCode: 0 }
    },
  })
  const text = await reply($, 'music start')
  expect(text).toContain('xcode-select --install')
  expect(text).not.toContain("couldn't start")
  expect(toasts.join(' ')).not.toContain('building')
  expect(runs.some((argv) => argv[0] === '/usr/bin/xcrun')).toBe(false)
})

test('6c. music mode left waiting on the permission dialog answers in time, then gives up after 30 seconds and says why', { timeoutMs: 60_000 }, async ($, on) => {
  const { clock, ears, toasts } = await start($, on, { ears: 'silent' })
  let text = ''
  const running = $.command.run(clawd('music start')).then((r: any) => (text = String(r?.text ?? '')))
  // The command answers within a hook's budget, saying what it waits on
  for (let i = 0; i < 9 && !text; i++) await clock.advance(1000)
  await running
  expect(text).toContain('click Allow')
  expect(text).toContain('30 seconds')
  for (let i = 0; i < 20; i++) await clock.advance(1000)
  expect(toasts.join(' ')).not.toContain('within 30 seconds')
  for (let i = 0; i < 3; i++) await clock.advance(1000)
  expect(toasts.join(' ')).toContain('within 30 seconds')
  expect(await reply($, 'music stop')).toBe('Music mode was already off.')
  await new Promise((r) => setTimeout(r, 200))
  expect(ears.killed).toBe(true)
})

test('6d. a permission given after the command answered turns music mode on, with a toast', { timeoutMs: 60_000 }, async ($, on) => {
  const { clock, toasts } = await start($, on, { ears: 'late' })
  let text = ''
  const running = $.command.run(clawd('music start')).then((r: any) => (text = String(r?.text ?? '')))
  for (let i = 0; i < 9 && !text; i++) await clock.advance(1000)
  await running
  expect(text).toContain('click Allow')
  for (let i = 0; i < 50 && !toasts.join(' ').includes('headphones on'); i++) await new Promise((r) => setTimeout(r, 100))
  expect(toasts.join(' ')).toContain('headphones on')
  // It stays on past the 30 seconds
  for (let i = 0; i < 30; i++) await clock.advance(1000)
  expect(await reply($, 'music stop')).toContain('Music mode is off')
})

test('7. starting the game turns music mode off, and says so', async ($, on) => {
  const { ears } = await start($, on)
  expect(await reply($, 'music start')).toContain('headphones on')
  const text = await reply($, 'game')
  expect(text).toContain('Game on!')
  expect(text).toContain('Music mode is off while you play.')
  expect(await reply($, 'music stop')).toBe('Music mode was already off.')
  await new Promise((r) => setTimeout(r, 200))
  expect(ears.killed).toBe(true)
})

test('8. every hook Clawd shares with the checklist hands the event on when it fails, turn.abort too', async () => {
  // The hooks as register() sets them up, each noting whether it was given a .catch
  const hooks: { event: string; caught: boolean }[] = []
  const on = (event: string) => {
    const hook = { event, caught: false }
    hooks.push(hook)
    return { catch: () => void (hook.caught = true) }
  }
  register(on, {})
  for (const event of ['session.start', 'turn.start', 'turn.complete', 'turn.abort', 'tool.call', 'prompt.edit']) {
    expect(hooks.filter((h) => h.event === event).every((h) => h.caught)).toBe(true)
  }
  expect(hooks.some((h) => h.event === 'turn.abort')).toBe(true)
})

test('9. the terminal is told of no ✕, the desktop app is', async ($, on) => {
  await start($, on)
  await $.ui.mount(TBAND)
  const text = await reply($, 'game')
  expect(text).toContain('Game on!')
  expect(text).not.toContain('✕')
  expect(text).not.toContain('desktop')
})

test("10. in a terminal too short for the game a space stays a space; where it's drawn it's a jump", async ($, on) => {
  await start($, on)
  const space = { origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: ' ' } as any
  const short = await $.ui.mount({ ...TBAND, viewport: { columns: 120, rows: 20 } })
  await $.command.run(clawd('game'))
  await short.redraw()
  expect(json(await short.drawn())).not.toContain('clawd-game')
  expect((await $.prompt.edit(space)).text).toBe(' ')
  await short.unmount()
  const tall = await $.ui.mount(TBAND)
  expect(json(await tall.drawn())).toContain('clawd-game')
  expect((await $.prompt.edit(space)).text).toBe('')
})

test('11. /clawd model and /clawd effort say that music mode and the game stopped for the switch', async ($, on) => {
  await start($, on, { config: true })
  expect(await reply($, 'model sonnet')).toBe('Clawd now chats with sonnet.')
  await reply($, 'music start')
  expect(await reply($, 'model opus')).toContain('music mode stopped')
  await reply($, 'game')
  const text = await reply($, 'effort high')
  expect(text).toContain('the game stopped')
  expect(text).not.toContain('music')
})
