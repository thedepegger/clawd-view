import { expect, mock, test } from './kit'

// The game puts itself away after a minute nobody plays, and stays while someone keeps jumping

const BAND = {
  plugin: 'clawd-view', surface: 'terminal', component: 'AbovePrompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 115, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

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
  on('command.run', () => ({ text: '' }))
  on('prompt.edit', (_: unknown, e: any) => ({ text: e.text + e.inputText, cursor: e.start + e.inputText.length }))
  const toasts: string[] = []
  on('ui.toast', (_: unknown, e: any) => {
    toasts.push(String(e.text ?? e.message ?? JSON.stringify(e)))
    return { value: undefined }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  return { clock, toasts }
}
const hasGame = async (ui: any) => (await ui.find({ key: 'clawd-game' })) !== undefined || JSON.stringify(await ui.drawn()).includes('clawd-game')

test('a game nobody plays for a minute is put away, with a toast saying so', { timeoutMs: 60_000 }, async ($, on) => {
  const { clock, toasts } = await start($, on)
  const ui = await $.ui.mount(BAND)
  await $.command.run({ command: 'clawd', args: 'game' })
  await ui.redraw()
  expect(await hasGame(ui)).toBe(true)
  for (let i = 0; i < 5; i++) await clock.advance(10_000)
  await ui.redraw()
  expect(await hasGame(ui)).toBe(true)
  for (let i = 0; i < 2; i++) await clock.advance(10_000)
  await ui.redraw()
  expect(await hasGame(ui)).toBe(false)
  expect(toasts.join(' ')).toContain('Nobody played for a minute')
})

test('a jump (space in the empty prompt) keeps the game up for another minute', { timeoutMs: 60_000 }, async ($, on) => {
  const { clock } = await start($, on)
  const ui = await $.ui.mount(BAND)
  await $.command.run({ command: 'clawd', args: 'game' })
  for (let i = 0; i < 5; i++) await clock.advance(10_000)
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: ' ' })
  for (let i = 0; i < 5; i++) await clock.advance(10_000)
  await ui.redraw()
  expect(await hasGame(ui)).toBe(true)
  for (let i = 0; i < 2; i++) await clock.advance(10_000)
  await ui.redraw()
  expect(await hasGame(ui)).toBe(false)
})
