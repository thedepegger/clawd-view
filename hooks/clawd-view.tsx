import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderChildren, RenderElement, SessionMeasureInput, SessionUsage } from 'claude-code'

import type { Checklist, ChecklistTask, StatusLimit as Limit, StatusLimitView, StatusReading, StatusUsage as Usage } from '../types'

// Clawd's orange, as Claude Code draws its logo
const ORANGE = '#e8714e'

type Engine = EngineInterface

const enabled = atom({ plugin: 'clawd-view', key: 'clawdViewEnabled' } as const, true)
const checklist = atom({ plugin: 'clawd-view', key: 'checklist' } as const, null)
const tick = atom({ plugin: 'clawd-view', key: 'tick' } as const, 0)
// Whether the person is typing a slash command: the box steps down to its title row so the
// command menu below the prompt has the screen
const draftIsCommand = atom({ plugin: 'clawd-view', key: 'draftIsCommand' } as const, false)
// Whether the running model turn was started by a background notice. Kept in plugin state, not in
// the module, so a reload in the middle of a background turn still leaves the finished card alone
const backgroundTurn = atom({ plugin: 'clawd-view', key: 'isBackgroundTurn' } as const, false)

const STORE_KEY = 'clawdViewEnabled'
const PLAN_TOOL = 'mcp__clawd-view__plan_steps'
const PROGRESS_TOOL = 'mcp__clawd-view__report_progress'
const ALWAYS_ALLOWED = new Set([
  'ToolSearch',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'AskUserQuestion',
  PLAN_TOOL,
  PROGRESS_TOOL,
])
const PLACEHOLDER = 'placeholder-'
const MAX_NAME = 40
// The bar takes about a fifth of the card: 16 to 28 cells, 10 in a narrow terminal.
function meterWidth(inner: number): number {
  return inner < BUDDY_MIN_INNER ? 10 : Math.max(16, Math.min(28, Math.round(inner * 0.22)))
}
// Bars are drawn three quarters tall, so the bars of stacked steps stay apart instead of
// merging into one block (full blocks touch, more so with Ghostty's taller cells).
const BAR = '▆'
// A waiting step's bar: the same shape, in a faded dark orange, so it reads as an empty bar
const EMPTY_BAR = '#54291c'
// The working bar: a wave of Clawd's orange, light to deep and back over 24 cells, cut into
// 2-cell bands of one solid shade each, so every partition shows as a clean edge. 7 shades,
// light to deep, repeated along the whole bar and sliding continuously, like a marquee.
const SMOOTH_WAVE = 24
// Cells per band: each band is one solid shade
const BAND = 2
// Cells the wave moves each frame (4 frames a second): one whole band, so edges stay crisp
const WAVE_SPEED = 2
// The animation's frame time: 4 frames a second
export const FRAME_MS = 250
const LIGHT = [0xef, 0x9a, 0x81]
const DEEP = [0xe3, 0x51, 0x26]
/** The band's color at position p along the wave. */
function smoothShade(p: number): string {
  const bands = SMOOTH_WAVE / BAND
  const half = bands / 2
  const band = Math.floor((((p % SMOOTH_WAVE) + SMOOTH_WAVE) % SMOOTH_WAVE) / BAND)
  const t = (band <= half ? band : bands - band) / half

  return `#${LIGHT.map((v, k) => Math.round(v + (DEEP[k]! - v) * t).toString(16).padStart(2, '0')).join('')}`
}
// The desktop app draws text in a font whose bar glyph is wider than a cell and leaves a gap
// between glyphs, so a text bar there ends in "…" and the wave breaks into blocks. There each bar
// is an Svg instead: one solid rect per cell, DESKTOP_CELL_PX wide (the width the app gives a
// cell), so it fills its column exactly and the wave flows as it does in the terminal
const DESKTOP_CELL_PX = 8
const DESKTOP_BAR_PX = 11
// The engine refuses an Svg (and the whole tree around it) unless its size is 1 to 4096 pixels
const SVG_MAX_PX = 4096
export function svgPx(px: number): number {
  return Math.max(1, Math.min(SVG_MAX_PX, Math.round(px)))
}
/** One solid rect per run of same-colored cells, starting at cell `from`. */
function barRects(colors: string[], from = 0): string[] {
  const rects: string[] = []
  for (let i = 0; i < colors.length; ) {
    let end = i + 1
    while (end < colors.length && colors[end] === colors[i]) end++
    rects.push(`<rect x="${(from + i) * DESKTOP_CELL_PX}" y="0" width="${(end - i) * DESKTOP_CELL_PX}" height="${DESKTOP_BAR_PX}" fill="${colors[i]}"/>`)
    i = end
  }
  return rects
}
/** A bar of these colors, one a cell. With `isWave`, the working bar's wave instead: the desktop
 *  app gets no redraw each frame (a redraw there drops a press in flight), so the wave moves in
 *  the drawing itself, as the terminal's does: WAVE_SPEED cells every FRAME_MS, in steps, one
 *  whole wave (SMOOTH_WAVE cells) a loop, so the loop's end meets its start exactly. */
export function barSvg(colors: string[], isWave = false): string {
  const w = svgPx(colors.length * DESKTOP_CELL_PX)
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${DESKTOP_BAR_PX}" viewBox="0 0 ${w} ${DESKTOP_BAR_PX}" shape-rendering="crispEdges">`
  if (!isWave) return `${open}${barRects(colors).join('')}</svg>`
  // One wave more than the bar to its left, which slides in as the whole moves right
  const cells = Array.from({ length: colors.length + SMOOTH_WAVE }, (_, i) => smoothShade(i - SMOOTH_WAVE))
  const frames = SMOOTH_WAVE / WAVE_SPEED
  const values = Array.from({ length: frames }, (_, f) => `${f * WAVE_SPEED * DESKTOP_CELL_PX} 0`).join(';')
  const motion = `<animateTransform attributeName="transform" type="translate" values="${values}" dur="${(frames * FRAME_MS) / 1000}s" calcMode="discrete" repeatCount="indefinite"/>`
  return `${open}<g>${barRects(cells, -SMOOTH_WAVE).join('')}${motion}</g></svg>`
}
const FALLBACK_NAME = 'Working on it'
// The card's accent is Clawd's own orange.
const CARD_ORANGE = ORANGE
// One hue: Clawd's orange (#e8714e, hue 13.6, saturation 77%), deepest to lightest. No pink.
const SHADES = ['#e35126', '#e56038', '#e8714e', '#ea7d5d', '#ec8b6f', '#ef9a81']
const hexRgb = (h: string) => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16))
const mixRgb = (a: number[], b: number[], t: number) => a.map((v, k) => Math.round(v + (b[k]! - v) * t))
const rgbHex = (c: number[]) => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`
// A soft glow that sweeps across the title now and then: about 3 seconds to cross, then a rest
export const GLOW_CYCLE = 24
const GLOW_CROSS = 12
const GLOW_COLOR = '#ffd6c4'
const GLOW_MAX = 0.55
/** How much of the glow letter i of an n-letter title gets on frame f: 0 to GLOW_MAX. */
export function glowAt(i: number, f: number, n: number): number {
  const step = ((f % GLOW_CYCLE) + GLOW_CYCLE) % GLOW_CYCLE
  if (step >= GLOW_CROSS) return 0
  // The glow's centre starts just before the first letter and ends just past the last
  const head = -3 + (step / (GLOW_CROSS - 1)) * (n + 5)
  return Math.max(0, 1 - Math.abs(i - head) / 3) * GLOW_MAX
}
/** The title's color at letter i of n on frame f. One gentle wave of deep to light orange, about
 *  48 letters long, drifting along the title (one wave every 7 seconds): next letters and next
 *  frames differ by only a few shades, so the fade reads as smooth, never as steps. The glow
 *  passes over it. */
export function titleShade(i: number, f: number, n: number): string {
  const base = (1 + Math.sin(2 * Math.PI * (i / 48 - f / 28))) / 2
  const wave = mixRgb(hexRgb('#e35126'), hexRgb('#ec8b6f'), base)
  return rgbHex(mixRgb(wave, hexRgb(GLOW_COLOR), glowAt(i, f, n)))
}
// Everything in the box is Clawd's orange: done, needs-you and stuck too. The one other hue is
// the grey of a stopped job. (Ghostty puts orange in ANSI slot 2, so no named colors here.)
const DONE_ORANGE = CARD_ORANGE
// Under this many cells inside the card the bars shorten to 10 cells, so step names keep their room
const BUDDY_MIN_INNER = 56

const GATE_MESSAGE =
  'Clawd View: call plan_steps first (mcp__clawd-view__plan_steps; load it with ToolSearch if it is deferred). ' +
  'Lay out 1 to 8 plain-English steps, then continue with this tool.'

const PROMPT_SECTION = [
  '# Clawd View (plain-English progress checklist)',
  'The person using this session prefers to follow your progress in plain English. A checklist of your plan is shown to them while you work, and the tool calls are hidden.',
  '- For every request, even a quick question, call `mcp__clawd-view__plan_steps` first with 1 to 8 short steps in order. If it is deferred, load it with ToolSearch first.',
  '- Then call `mcp__clawd-view__report_progress` as real progress happens, and with percent 100 the moment a step finishes.',
  '- Write every step name in plain English anyone can understand. Keep it under 40 characters and start it with a verb, like "Build the pricing section".',
  '- Never put file paths, file names, commands, code or tool names in a step name.',
  '- If this session has TodoWrite or TaskCreate, you may use that to-do list as the plan instead, with the same plain-English names.',
].join('\n')

const CODE_EXTENSION =
  /\.(tsx?|jsx?|mjs|cjs|mts|cts|swift|py|rb|go|rs|java|kts?|c|cc|cpp|h|hpp|m|mm|cs|php|json|jsonc|ya?ml|toml|md|mdx|html?|css|scss|sass|less|sh|zsh|bash|fish|sql|xml|plist|lock|vue|svelte|ipynb|gradle|env|ini|cfg|conf|txt|log|csv|pbxproj|xcconfig|dart|lua|pl|ex|exs|scala|zig|wasm|graphql|proto)$/i

/** Every name on screen passes through here: no code, paths or file names, 40 characters at most. */
export function cleanName(raw: string): string {
  const words = raw
    .replace(/`[^`]*`?/g, ' ')
    .replace(/`/g, ' ')
    .split(/\s+/)
    .filter(word => {
      if (word === '' || word.includes('/') || word.includes('\\')) return false
      return !CODE_EXTENSION.test(word.replace(/[.,;:!?'")\]]+$/, ''))
    })
  let name = words.join(' ').replace(/[\s,;:(\-]+$/, '').trim()
  if (name === '') return FALLBACK_NAME
  name = name.charAt(0).toUpperCase() + name.slice(1)
  if (name.length <= MAX_NAME) return name
  const cut = name.slice(0, MAX_NAME - 1)
  const space = cut.lastIndexOf(' ')
  const base = (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.(\-]+$/, '')

  return `${base}…`
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)

  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds % 60}s`
}

function task(id: string, name: string, status: ChecklistTask['status']): ChecklistTask {
  return { id, name, status, percent: status === 'done' ? 100 : 0, hasReported: false }
}

function newJob(startedAt: number, title: string): Checklist {
  return {
    title,
    phase: 'working',
    tasks: [
      task(`${PLACEHOLDER}1`, 'Understand your request', 'active'),
      task(`${PLACEHOLDER}2`, 'Plan the steps', 'upcoming'),
    ],
    needsYouReason: null,
    stuckReason: null,
    startedAt,
    finishedAt: null,
    isCollapsed: false,
  }
}

function hasRealPlan(c: Checklist | null): boolean {
  return c !== null && c.tasks.some(t => !t.id.startsWith(PLACEHOLDER))
}

function isRunning(c: Checklist): boolean {
  return c.phase === 'working' || c.phase === 'needs-you' || c.phase === 'stuck'
}

/** Still in its turn: running, and not a stuck job whose turn already ended. */
function isLive(c: Checklist): boolean {
  return isRunning(c) && c.finishedAt === null
}

// Failures of tools that only look things up (a search that finds nothing) never mean stuck
const LOOKUP_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'ToolSearch', 'LS', 'NotebookRead'])
const STUCK_AFTER = 3
// Text that starts a turn (or sits in the transcript) without the person typing it: background
// tasks, reminders, commands, hooks, interrupt notes. One list, used live and by the history scan
const NOT_TYPED_PREFIXES = [
  '<task-notification', '<system-reminder', '<command-', '<local-command', '<bash-', '<user-prompt-submit-hook', '[Request interrupted',
  'Another Claude session sent a message:', '<agent-message',
]
// "The agent-dock plugin sent a message: ..." and the like
const PLUGIN_MESSAGE = /^The [\w.@-]+ plugin sent a message:/
export const isNotTyped = (text: string) => NOT_TYPED_PREFIXES.some(p => text.startsWith(p)) || PLUGIN_MESSAGE.test(text)
/** A slash command (typed, or as the engine expands it) is the person's own request. */
export const isCommand = (text: string) => text.startsWith('/') || text.startsWith('<command-')
// The person's own Enter at the prompt (or their remote control), never a notice, peer or plugin
const HUMAN_ORIGINS = new Set(['composer', 'bridge'])
// Set as each model turn starts (the backgroundTurn atom): true for a turn a background notice
// started. Such a turn never touches the main box, so a finished card stays finished and no new
// steps appear on it
const isBackgroundTurn = ($: Engine) => read($, backgroundTurn)
async function setBackgroundTurn($: Engine, value: boolean): Promise<void> {
  if ((await read($, backgroundTurn)) !== value) await update($, backgroundTurn, () => value)
}
// Who sent the prompt the next idle turn starts from, as prompt.submit's origin said: true for the
// person, false for a notice, peer or plugin, null when no idle prompt is waiting (then the text decides)
let nextTurnIsHuman: boolean | null = null
// The plan gate is armed only by a turn the person started and only until it has a plan. Anything
// else (a background turn, a reload, a cleared or stuck card) never denies a tool
let isGateArmed = false
// Tools the gate turned away this turn: after GATE_GIVES_UP of them it lets everything through, so
// a model that cannot or will not plan is never stuck
let gateDenials = 0
const GATE_GIVES_UP = 2
// Turns in a row the gate gave up with no plan: past GATE_RESTS_AFTER the model can't reach
// plan_steps (a permission rule, a restricted tool set), so the gate rests until a plan arrives
let gateGaveUpTurns = 0
const GATE_RESTS_AFTER = 2
// Whether the model's last request offered plan_steps (by name, or through ToolSearch), as
// prompt.compose saw it for a person at a screen; null until a request has been composed
let planToolOffered: boolean | null = null
// Whether a person is at the prompt, as session.start said: a `-p` run or the SDK has no checklist
// to show, so it gets no plan instructions, no gate and no job name
let isInteractive = true
// Set when the person says no to a step this turn, so the job ends saying so instead of All done
// or "you pressed Esc"
let wasRefused = false

/** Terminal cells a code point takes: 2 for East Asian wide and emoji, 0 for joiners and marks. */
function cellsOf(cp: number): number {
  if (cp === 0x200d || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x300 && cp <= 0x36f)) return 0
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0x303e) || (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) || (cp >= 0x1f900 && cp <= 0x1faff) || (cp >= 0x1f7e0 && cp <= 0x1f7ff) ||
    (cp >= 0x1f000 && cp <= 0x1f2ff) || (cp >= 0x20000 && cp <= 0x3fffd) ||
    [0x231a, 0x231b, 0x23e9, 0x23ea, 0x23eb, 0x23ec, 0x23f0, 0x23f3, 0x25fd, 0x25fe, 0x2614, 0x2615, 0x267f, 0x2693,
      0x26a1, 0x26aa, 0x26ab, 0x26bd, 0x26be, 0x26c4, 0x26c5, 0x26ce, 0x26d4, 0x26ea, 0x26f2, 0x26f3, 0x26f5, 0x26fa,
      0x26fd, 0x2705, 0x270a, 0x270b, 0x2728, 0x274c, 0x274e, 0x2753, 0x2754, 0x2755, 0x2757, 0x2795, 0x2796, 0x2797,
      0x27b0, 0x27bf, 0x2b1b, 0x2b1c, 0x2b50, 0x2b55].includes(cp) ||
    (cp >= 0x2648 && cp <= 0x2653)
  return wide ? 2 : 1
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null

/** The characters a person sees (grapheme clusters): a family emoji or an accented letter is one. */
function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), s => s.segment) : Array.from(text)
}

/** Cells one visible character takes: an emoji presentation (VS16) or any wide part makes it 2. */
function clusterCells(cluster: string): number {
  if (cluster.includes('\uFE0F')) return 2
  let widest = 0
  for (const ch of cluster) widest = Math.max(widest, cellsOf(ch.codePointAt(0) ?? 0))
  return widest
}

/** How many terminal cells a string takes. */
export function cellWidth(text: string): number {
  let n = 0
  for (const g of graphemes(text)) n += clusterCells(g)
  return n
}

/** Exactly `width` cells: cut between whole visible characters with an ellipsis when too long, else padded. */
export function fitCells(text: string, width: number): string {
  if (cellWidth(text) <= width) return text + ' '.repeat(width - cellWidth(text))
  let out = ''
  let used = 0
  for (const g of graphemes(text)) {
    const w = clusterCells(g)
    if (used + w > Math.max(0, width - 1)) break
    out += g
    used += w
  }
  return `${out}…${' '.repeat(Math.max(0, width - used - 1))}`
}

function realTasks(c: Checklist): ChecklistTask[] {
  return c.tasks.filter(t => !t.id.startsWith(PLACEHOLDER))
}

/** Starts the first upcoming step when nothing is active. */
function startNext(tasks: ChecklistTask[]): ChecklistTask[] {
  if (tasks.some(t => t.status === 'active')) return tasks
  const next = tasks.findIndex(t => t.status === 'upcoming')
  if (next === -1) return tasks

  return tasks.map((t, i) => (i === next ? { ...t, status: 'active' } : t))
}

// Words a step name can gain or lose between the plan and a report without becoming another step
const FILLER_WORDS = new Set(['the', 'a', 'an', 'your', 'my', 'our', 'this', 'that', 'its', 'of', 'to', 'for', 'and'])
// Steps reports may add beyond the plan: past this, a new name counts toward the step being worked on
const MAX_ADDED_STEPS = 3
const ADDED = 'added-'

/** A step name reduced to its words: no case, punctuation, ellipsis or filler words. */
function looseName(name: string): string {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w !== '' && !FILLER_WORDS.has(w))
    .join(' ')
}

/** Whether two step names are the same once loosened. */
function isLooseEqual(a: string, b: string): boolean {
  const x = looseName(a)
  return x !== '' && x === looseName(b)
}

/** Whether one step name is a whole-word part of the other, once loosened. */
function isPartOf(a: string, b: string): boolean {
  const x = looseName(a)
  const y = looseName(b)
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  // A short name ("Check it") is too vague to be found inside another step's name
  return short.length > 8 && ` ${long} `.includes(` ${short} `)
}

export function applyProgress(tasks: ChecklistTask[], rawName: string, rawPercent: number, step?: number): ChecklistTask[] {
  const percent = Math.max(0, Math.min(100, Math.round(Number.isFinite(rawPercent) ? rawPercent : 0)))
  const real = tasks.filter(t => !t.id.startsWith(PLACEHOLDER))
  let list = real
  // A step number (1-based), or a name that is only a number, picks that planned step
  const numbered = step ?? (/^\s*\d+\s*$/.test(rawName) ? Number(rawName) : undefined)
  const byNumber = numbered !== undefined && Number.isInteger(numbered) && numbered >= 1 && numbered <= list.length
  const name = byNumber ? list[numbered! - 1]!.name : cleanName(rawName)
  // A missing name, or one that is all code, says nothing about which step it means: it never
  // matches a step that happens to be called "Working on it"
  const isNameless = !byNumber && (rawName.trim() === '' || name === FALLBACK_NAME)
  const isOpen = (t: ChecklistTask) => t.status !== 'done'
  const isExact = (t: ChecklistTask) => t.name.toLowerCase() === name.toLowerCase()
  let at = -1
  if (byNumber) {
    at = numbered! - 1
  } else if (!isNameless) {
    // A step still to do wins over a finished one of the same name, and the closest name wins:
    // exact, then equal once loosened, then one name a part of the other
    const matchers = [isExact, (t: ChecklistTask) => isLooseEqual(t.name, name), (t: ChecklistTask) => isPartOf(t.name, name)]
    for (const isMatch of matchers) if (at === -1) at = list.findIndex(t => isOpen(t) && isMatch(t))
    if (at === -1) at = list.findIndex(t => matchers.some(isMatch => isMatch(t)))
  }
  const isAtCap = list.filter(t => t.id.startsWith(ADDED)).length >= MAX_ADDED_STEPS

  if (at === -1 && (isNameless || isAtCap)) {
    // No usable name (or no room for another step): the percent belongs to the step being worked
    // on, never to a new one
    const active = list.findIndex(t => t.status === 'active')
    at = active !== -1 ? active : list.findIndex(isOpen)
    if (at === -1) return list
  } else if (at === -1) {
    // A name that isn't in the plan becomes a new step, worked on now.
    const active = list.findIndex(t => t.status === 'active')
    const firstOpen = list.findIndex(isOpen)
    at = active !== -1 ? active : firstOpen !== -1 ? firstOpen : list.length
    const added = task(`${ADDED}${Date.now()}-${list.length}`, name, 'upcoming')
    list = [...list.slice(0, at), added, ...list.slice(at)]
  }

  // A step already ticked off stays ticked: a late or repeated report never reopens it
  if (list[at]!.status === 'done') return list

  list = list.map((t, i) => {
    if (i < at) return { ...t, status: 'done', percent: 100 }
    if (i === at) {
      return percent >= 100
        ? { ...t, status: 'done', percent: 100, hasReported: true }
        : { ...t, status: 'active', percent, hasReported: true }
    }
    return t.status === 'active' ? { ...t, status: 'upcoming' } : t
  })

  return startNext(list)
}

export function planFrom(steps: readonly string[]): ChecklistTask[] {
  return steps
    .slice(0, 8)
    .map((s, i) => task(`step-${i + 1}`, cleanName(s), i === 0 ? 'active' : 'upcoming'))
}

function fromTodoStatus(status: 'pending' | 'in_progress' | 'completed'): ChecklistTask['status'] {
  return status === 'completed' ? 'done' : status === 'in_progress' ? 'active' : 'upcoming'
}

export function errorSentence(kind: string | undefined, text: string): string {
  const all = `${kind ?? ''} ${text}`
  if (kind === 'rate_limit' || /rate.?limit|usage limit|\b429\b/i.test(all)) {
    return 'you hit your usage limit, try again a little later'
  }
  if (kind === 'overloaded' || /overloaded|\b529\b/i.test(all)) {
    return "Claude's servers are busy, try again in a minute"
  }
  if (/prompt is too long|context (window|length|limit)|too many tokens|max_output_tokens/i.test(all)) {
    return 'the conversation is too long, type /compact and try again'
  }
  if (
    kind === 'authentication_failed' ||
    kind === 'oauth_org_not_allowed' ||
    kind === 'cloud_credential_error' ||
    /authenticat|log ?in|\b401\b|unauthori[sz]ed/i.test(all)
  ) {
    return 'you need to sign in again, type /login'
  }
  if (/network|connection|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|socket|offline/i.test(all)) {
    return 'the internet connection dropped'
  }
  if (kind === 'billing_error') return 'there is a problem with your plan or billing'

  return 'something went wrong, try again'
}

const USER_SAID_NO = /doesn't want to proceed|tool use was rejected|user rejected|user denied|user declined/i

// Module state: lost on reload, which only resets the counters and the clock.
let clock: { cancel: () => void } | undefined
let failures = 0
let lastError: { kind: string; details: string } | undefined

/** Whether the card moves: while Claude works (stuck mid-turn too, so the time keeps going).
 *  A done card is drawn in its final, folded form from its first frame, so it stands still; a
 *  turn that ended in an error, a refusal or Esc has a finishedAt and stands still too. */
export function isAnimated(c: Checklist | null): boolean {
  if (c === null) return false
  if (c.phase === 'done') return false
  if (c.phase === 'stopped') return false

  return c.finishedAt === null
}

async function syncClock($: Engine, c: Checklist | null): Promise<void> {
  const wants = isAnimated(c) && (await read($, enabled))
  if (wants && clock === undefined) {
    // 4 frames a second at most: every redraw repaints the whole live area, and fewer of them
    // leave less behind when the terminal is busy printing above it
    clock = $.clock.every(FRAME_MS, () => void update($, tick, n => n + 1))
  } else if (!wants && clock !== undefined) {
    clock.cancel()
    clock = undefined
  }
}

// Only a change is written, so typing never redraws the box for nothing. Compared with the stored
// value itself (it outlives a reload), never a copy in this module that a reload resets
async function setDraftIsCommand($: Engine, value: boolean): Promise<void> {
  if ((await read($, draftIsCommand)) === value) return
  await update($, draftIsCommand, () => value)
}

// The draft a '/' edit is about to make, while the engine has not applied it yet: the box draws
// from it, since the prompt box still holds the old draft then. Cleared once the edit lands
let pendingDraft: string | null = null

/** True while the person's draft really starts with '/': the flag alone can outlive the draft. */
async function isSlashDraft($: Engine): Promise<boolean> {
  if (!(await read($, draftIsCommand))) return false
  const draft = pendingDraft ?? (await $.prompt.read().catch(() => ({ text: '' }))).text
  return draft.trimStart().startsWith('/')
}

// The main screen's live area, row by row, measured in a 31x115 Ghostty session (2026-10-08):
// while Claude works, a blank, the spinner and its tip (which wraps to 2 rows) sit above the box;
// once a turn ends, a blank and the "Cooked for…" line. The prompt is 3 rows (two rules and the
// input), next-steps' list under the band up to 6 (it hides while Claude works), and the footer 3
// rows, plus a blank, a "main" row and one row an agent while any background agent is listed
export const ABOVE_WORK_ROWS = 4
export const ABOVE_IDLE_ROWS = 2
export const PROMPT_ROWS = 3
// next-steps is turned off (2026-10-08) so a finished box has the rows for the full figures
export const NEXT_STEPS_ROWS = 0
export const FOOTER_BASE_ROWS = 3
// One spare row for anything else that pops up (a wrapped status line, a toast)
export const SAFETY_ROWS = 1
// Room kept free for the command menu's first frame (see prompt.edit); while the draft starts with
// '/' the band budgets menuRows instead
export const MENU_SPARE_ROWS = 5
// The command menu itself, measured live: about half the terminal's rows. While the draft starts
// with '/', the band budgets this much under the prompt
export function menuRows(maxRows: number): number {
  return Math.ceil(maxRows / 2)
}
// The mascot on the main screen: 5 rows, shown from 26 terminal rows up
export const CLAWD_ROWS = 5
export const CLAWD_MIN_TERMINAL_ROWS = 26
// The footer lists at most this many background agents, a row each, with 2 rows around them
export const FOOTER_AGENT_CAP = 6
export function footerRows(agents: number): number {
  return FOOTER_BASE_ROWS + (agents > 0 ? 2 + Math.min(agents, FOOTER_AGENT_CAP) : 0)
}
/** The rows the box may take on the main screen in each moment: while Claude works (Clawd and
 *  next-steps step aside, the spinner and its tip sit above) and between turns (next-steps' list
 *  under the band, Clawd's rows not counted here: the caller takes them off when it shows him). */
export function mainScreenRoom(maxRows: number, agents: number): { work: number; idle: number } {
  const footer = footerRows(agents)
  return {
    work: maxRows - ABOVE_WORK_ROWS - PROMPT_ROWS - footer - SAFETY_ROWS - MENU_SPARE_ROWS,
    idle: maxRows - ABOVE_IDLE_ROWS - NEXT_STEPS_ROWS - PROMPT_ROWS - footer - SAFETY_ROWS - MENU_SPARE_ROWS,
  }
}
// The info block: a blank line and 5 facts a line
const FULL_INFO_ROWS = 6

// The box's forms: the full info block under the steps, the steps with their steps line, the
// steps alone, or a single line
export type Tier = 'full' | 'condensed' | 'compact' | 'line'

/** How much the box shows for the rows it may take. Full needs a card wide enough for its two
 *  columns and room for every one of its `steps` (border, title, steps line, steps, figures). */
export function pickTier(boxCap: number, canFull: boolean, steps = 2): Tier {
  if (canFull && boxCap >= 4 + steps + FULL_INFO_ROWS) return 'full'
  if (boxCap >= 8) return 'condensed'
  if (boxCap >= 6) return 'compact'
  return 'line'
}

/** Which steps the box shows in `room` rows, the window sliding to keep the step at `anchor` in view
 *  (one step above it when there is room). When steps are hidden, a row at the top counts those
 *  above and a row at the bottom those below, taking a step's row each, so the box never grows. */
export function stepWindow(total: number, anchor: number, room: number): { start: number; end: number; above: number; below: number } {
  if (room >= total) return { start: 0, end: total, above: 0, below: 0 }
  const at = Math.max(0, Math.min(anchor, total - 1))
  const place = (k: number) => {
    const start = Math.max(0, Math.min(at - (k >= 3 ? 1 : 0), total - k))
    return { start, end: start + k }
  }
  // Fewer steps for each marker row the window needs, until it settles
  let k = Math.max(1, room)
  for (let i = 0; i < 3; i++) {
    const w = place(k)
    const marks = (w.start > 0 ? 1 : 0) + (w.end < total ? 1 : 0)
    const next = Math.max(1, room - marks)
    if (next === k) break
    k = next
  }
  const { start, end } = place(k)
  let above = start > 0 ? 1 : 0
  let below = end < total ? 1 : 0
  // Too few rows for every marker: the count of steps still to come stays first
  const spare = room - k
  if (above + below > spare) {
    if (below && spare >= 1) above = 0
    else if (above && spare >= 1) below = 0
    else above = below = 0
  }
  return { start, end, above: above ? start : 0, below: below ? total - end : 0 }
}

/** The whole checklist as plain lines, printed once into the conversation by /clawd-view steps. */
export function stepsText(c: { title: string; phase: string; tasks: { name: string; status: string; percent: number; hasReported?: boolean }[] } | null): string {
  if (c === null || c.tasks.length === 0) return 'No checklist yet. It appears once Claude starts a job.'
  const total = c.tasks.length
  const done = c.tasks.filter(t => t.status === 'done').length
  const activeAt = c.tasks.findIndex(t => t.status === 'active')
  const head = c.phase === 'done' || done === total
    ? `✓ ${c.title} · all ${total} steps done`
    : `✻ ${c.title} · step ${activeAt !== -1 ? activeAt + 1 : Math.min(total, done + 1)} of ${total}`
  const rows = c.tasks.map(t =>
    t.status === 'done' || c.phase === 'done'
      ? `  ✓ ${t.name}`
      : t.status === 'active'
        ? `  ● ${t.name} · ${t.hasReported ? `${t.percent}%` : 'working'}`
        : `  ○ ${t.name}`,
  )
  return [head, ...rows].join('\n')
}

/** The rows a drawn tree takes, counted the way the terminal lays it out: a column adds its
 *  children's rows, a row takes its tallest child, a border adds 2, margins and padding add theirs,
 *  and a set height wins. Anything it cannot read counts as nothing. */
export function countRows(node: unknown): number {
  if (node === null || node === undefined || node === false || node === true || node === '') return 0
  if (typeof node === 'string' || typeof node === 'number') return 1
  if (Array.isArray(node)) return node.reduce((sum: number, n) => sum + countRows(n), 0)
  if (typeof node !== 'object') return 0
  const n = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown }
  const p = n.props ?? {}
  if (p.display === 'none') return 0
  if (typeof p.height === 'number') return p.height
  if (n.type === 'Text' || n.type === 'Button') return 1
  const raw = n.children ?? p.children
  const kids = (Array.isArray(raw) ? raw.flat(Infinity) : [raw]).filter(k => k !== null && k !== undefined && k !== false && k !== '')
  const isColumn = p.flexDirection === 'column'
  let inner = kids.length === 0 ? 0 : isColumn ? kids.reduce((sum: number, k) => sum + countRows(k), 0) : Math.max(...kids.map(countRows))
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  inner += num(p.marginTop) + num(p.marginBottom) + num(p.marginY) * 2 + num(p.paddingTop) + num(p.paddingBottom) + num(p.paddingY) * 2
  if (p.borderStyle) inner += 2
  return inner
}

// Edits that change nothing skip the write, so readers are not redrawn for nothing.
async function edit($: Engine, fn: (c: Checklist | null) => Checklist | null): Promise<Checklist | null> {
  const current = await read($, checklist)
  let after: Checklist | null = fn(current)
  if (after === current) return current
  await update($, checklist, c => (after = fn(c)))
  await syncClock($, after)
  // A new job opens the side panel (fullscreen only; it seats when the terminal has the room)
  if (after !== null && (current === null || current.startedAt !== (after as Checklist).startedAt)) await openPanel($, false)

  return after
}

async function setEnabled($: Engine, value: boolean): Promise<void> {
  if ((await read($, enabled)) !== value) await update($, enabled, () => value)
  await $.store.set(STORE_KEY, value)
  await syncClock($, await read($, checklist))
  // Off closes the side panel; on reopens it for a job in progress
  if (!value) await closePanel($)
  else if ((await read($, checklist)) !== null) void openPanel($, false)
}

async function nameJob($: Engine, prompt: string, startedAt: number): Promise<void> {
  const reply = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 30,
    timeoutMs: 15000,
    system: 'You name jobs for a progress checklist read by non-technical people.',
    prompt:
      `Request:\n${prompt.slice(0, 2000)}\n\n` +
      'Name this job in 2 to 6 plain English words that start with a verb. ' +
      'No file names, paths, code or commands. Reply with the name only.',
  })
  if (!reply.isAnswered) return
  const words = reply.text.replace(/["*_#.]/g, ' ').split('\n')[0]?.trim().split(/\s+/).slice(0, 6) ?? []
  const title = cleanName(words.join(' '))
  if (title === FALLBACK_NAME) return
  // A newer job may have started while Haiku answered: then this name is stale.
  await edit($, c => (c !== null && c.startedAt === startedAt ? { ...c, title } : c))
}

const SAID_NO_REASON = 'you said no to a step, so Claude paused'
const SAID_NO_END = 'you said no to a step, so Claude stopped there'
const FAILING_END = 'a step kept failing, so Claude stopped there'

/** How a job that ends with steps left undone after a refusal, or while stuck, says why; null when it is simply done. */
function unfinishedEnding(c: Checklist): string | null {
  const isRefused = wasRefused || c.stuckReason === SAID_NO_REASON
  if (!isRefused && c.phase !== 'stuck') return null
  if (c.tasks.every(t => t.status === 'done')) return null

  return isRefused ? SAID_NO_END : FAILING_END
}

async function finishDone($: Engine, finishedAt: number): Promise<void> {
  // After a refusal, or stuck, with steps left: an honest ending, the unfinished steps left unticked
  const before = await read($, checklist)
  const ending = before === null ? null : unfinishedEnding(before)
  if (ending !== null) {
    await edit($, c => (c === null ? c : { ...c, phase: 'stuck', stuckReason: ending, needsYouReason: null, finishedAt }))
    return
  }
  await edit($, c =>
    c === null
      ? c
      : {
          ...c,
          phase: 'done',
          tasks: c.tasks.map(t => ({ ...t, status: 'done', percent: 100 })),
          needsYouReason: null,
          stuckReason: null,
          finishedAt,
        },
  )
  $.clock.after(5000, () => {
    void edit($, c => (c !== null && c.phase === 'done' && c.finishedAt === finishedAt ? { ...c, isCollapsed: true } : c))
  })
}

const PERMISSION_REASON = 'Claude needs your OK to continue'

/** A permission prompt is over once any loop (the main one or an agent's) takes its next step. */
async function clearPermission($: Engine): Promise<void> {
  const c = await read($, checklist)
  if (c === null || c.phase !== 'needs-you' || c.needsYouReason !== PERMISSION_REASON) return
  await edit($, x => (x !== null && x.phase === 'needs-you' && x.needsYouReason === PERMISSION_REASON ? { ...x, phase: 'working', needsYouReason: null } : x))
}

async function startedJob($: Engine): Promise<number> {
  return (await read($, checklist))?.startedAt ?? (await $.clock.now())
}

/** Replaces placeholders (or nothing) with real steps, keeping the job's header. */
async function setTasks($: Engine, fn: (tasks: ChecklistTask[]) => ChecklistTask[], isNewPlan = false): Promise<void> {
  const current = await read($, checklist)
  // A background turn leaves the card alone; a finished card only takes a new plan, never edits
  if ((await isBackgroundTurn($)) && (current === null || !isLive(current))) return
  if (current !== null && !isLive(current) && !isNewPlan) return
  // A plan made after the last job ended is a new job
  const isFresh = current === null || (isNewPlan && !isLive(current))
  const now = isFresh ? await $.clock.now() : await startedJob($)
  await edit($, c => {
    const base = c === null || (isNewPlan && !isLive(c)) ? newJob(now, c?.title ?? 'Your request') : c
    const tasks = fn(realTasks(base))

    return { ...base, tasks: tasks.length > 0 ? tasks : base.tasks }
  })
}

/** Ends the job when the main turn ends: done on an answer, stopped on Esc, stuck on an error. */
async function closeJob($: Engine, reason: string, answer: string): Promise<void> {
  const c = await read($, checklist)
  // A job that already ended (an error, Esc) keeps its ending when a background turn finishes later
  if (c === null || !isLive(c)) return
  const now = await $.clock.now()
  const e = { reason, answer }

  if (e.reason === 'error') {
    const sentence = errorSentence(lastError?.kind, lastError?.details ?? e.answer)
    await edit($, x => (x === null ? x : { ...x, phase: 'stuck', stuckReason: sentence, needsYouReason: null, finishedAt: now }))
  } else if (e.reason === 'refusal') {
    await edit($, x =>
      x === null ? x : { ...x, phase: 'stuck', stuckReason: "Claude couldn't help with that request", needsYouReason: null, finishedAt: now },
    )
  } else if (e.reason === 'aborted' && c.phase === 'stuck' && c.stuckReason === SAID_NO_REASON) {
    // Saying no at a permission prompt ends the turn as an abort: the ending says no, not Esc
    await edit($, x => (x === null ? x : { ...x, phase: 'stuck', needsYouReason: null, stuckReason: SAID_NO_END, finishedAt: now }))
  } else if (e.reason === 'aborted') {
    await edit($, x => (x === null ? x : { ...x, phase: 'stopped', needsYouReason: null, stuckReason: null, finishedAt: now }))
  } else {
    // Claude answered and stopped: the job is over, whether or not every step was ticked off
    await finishDone($, now)
  }
}

// The side panel (fullscreen only): its pane id, its width, and what the surface last said
const PANEL_ID = 'clawd-view'
const PANEL_COLUMNS = 64
let sawFullscreen = false
// The surface the band was last drawn on, so the panel's toast speaks to it
let bandSurface = 'terminal'
// The job whose panel the person closed by hand: it is not opened again for that job
let panelClosedFor: number | null = null

async function isPanelShown($: Engine): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === PANEL_ID && p.isPlaced && p.isShown)
  } catch {
    return false
  }
}

/**
 * Opens the side panel. Asked (the person pressed ▸ Panel) it seats at any width; opened on its own
 * when a job starts it seats from 110 columns once they have asked for it, from 144 before.
 */
async function openPanel($: Engine, isAsked: boolean): Promise<void> {
  try {
    if (!(await read($, enabled))) return
    if (!isAsked && !sawFullscreen) return
    const c = await read($, checklist)
    if (!isAsked && c !== null && panelClosedFor === c.startedAt) return
    const open = (await $.ui.panes()).some(p => p.id === PANEL_ID)
    if (open && !isAsked) return
    const placed = await $.ui.open({ id: PANEL_ID, title: 'Clawd View', columns: PANEL_COLUMNS })
    if (isAsked && !placed.isPlaced) {
      $.ui.toast(bandSurface === 'desktop'
        ? 'Clawd View: this app can\'t show the side panel yet, so the box stays above the prompt'
        : 'Clawd View: the panel needs fullscreen mode (/tui fullscreen)')
    }
  } catch {
    // The box stays above the prompt
  }
}

async function closePanel($: Engine): Promise<void> {
  try {
    if ((await $.ui.panes()).some(p => p.id === PANEL_ID)) await $.ui.close({ id: PANEL_ID })
  } catch {
    // Nothing open
  }
}

export function registerClawdView(on: On): void {
  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive !== false
    const saved = await $.store.get(STORE_KEY)
    if (typeof saved === 'boolean' && (await read($, enabled)) !== saved) await update($, enabled, () => saved)

    await $.tool.register({
      name: 'plan_steps',
      description:
        "Lay out the plan for the person's request before doing anything else: 1 to 8 short steps, in order. " +
        'Each step name is plain English a non-technical person understands: under 40 characters, starts with a verb, ' +
        'no file names, paths, commands, code or tool names. The first step starts right away. Call this first for every request.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 8,
            description: 'Step names in order, e.g. "Build the pricing section".',
          },
        },
        required: ['steps'],
      },
    })
    await $.tool.register({
      name: 'report_progress',
      description:
        'Report progress on the current step of the plan. Give the step name as planned, or its number. ' +
        'Send percent 100 the moment a step finishes; the next step then starts automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The step name, as planned.' },
          step: { type: 'integer', minimum: 1, description: 'The step number in the plan, starting at 1.' },
          percent: { type: 'number', minimum: 0, maximum: 100 },
        },
        required: ['percent'],
      },
    })
    await $.command.register({
      name: 'clawd-view',
      description: 'Turn Clawd View on or off: a plain-English checklist of each step, with the technical details hidden',
      argumentHint: 'on|off|steps|panel|help',
    })
    // A reload cancels the 5-second fold of a finished card: fold it now, so nothing animates forever
    await edit($, c => (c !== null && c.phase === 'done' && !c.isCollapsed ? { ...c, isCollapsed: true } : c))
    await syncClock($, await read($, checklist))
    // A draft that started with '/' before a reload (the /reload-plugins command itself) is gone now
    await update($, draftIsCommand, () => false)
    pendingDraft = null

    await startStatus($)
    // The first session with Clawd View: one tip on getting the full view, and where the guide is
    if ((await $.store.get(WELCOME_STORE)) !== true) {
      $.ui.toast(WELCOME_TIP)
      await $.store.set(WELCOME_STORE, true)
    }
    return next(e)
  })

  on('command.run', { command: 'clawd-view' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'panel') {
      // Asked by the person, so it seats at any width (fullscreen only); later jobs open it on their own
      await openPanel($, true)
      return { text: 'Clawd View panel opened.' }
    }
    if (arg === 'help') return { text: GUIDE }
    // Plain text, printed once: it scrolls with the conversation and never redraws
    if (arg === 'steps') return { text: stepsText(await read($, checklist)) }
    if (arg !== '' && arg !== 'on' && arg !== 'off') return { text: 'Use /clawd-view on, /clawd-view off, /clawd-view steps, /clawd-view panel, /clawd-view help, or /clawd-view to switch it.' }
    const value = arg === '' ? !(await read($, enabled)) : arg === 'on'
    await setEnabled($, value)

    return { text: value ? 'Clawd View is on.' : 'Clawd View is off: every step shows again.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    // Only a request a person watches, that can reach plan_steps (by name, or by loading it with
    // ToolSearch), is told to plan: a `-p` run, the SDK or a loop without the tool never is. A
    // request that offers no tools at all (a side question) says nothing about the gate
    const isWatched = isInteractive && e.surfaces.length > 0
    const canPlan = e.tools.includes(PLAN_TOOL) || e.tools.includes('ToolSearch')
    if (e.tools.length > 0) planToolOffered = isWatched && canPlan
    if (!isWatched || !canPlan || !(await read($, enabled))) return composed

    return {
      sections: [
        ...composed.sections.filter(s => s.id !== 'clawd-view:plain-steps'),
        { id: 'clawd-view:plain-steps', text: PROMPT_SECTION, scope: 'session' as const },
      ],
    }
  })

  on('turn.start', async ($, e, next) => {
    isMainTurnRunning = true
    const text = e.text.trim()
    // Typed requests and slash commands start a job; background notices never do. Messages are
    // counted where the person presses Enter (prompt.submit), not here
    const isHuman = nextTurnIsHuman
    nextTurnIsHuman = null
    const isBackground = isHuman !== null ? !isHuman : text !== '' && isNotTyped(text) && !isCommand(text)
    await setBackgroundTurn($, isBackground)
    isGateArmed = false
    gateDenials = 0
    wasRefused = false
    if (text !== '' && !isBackground) {
      // Only a typed request waits for a plan; a slash command starts a job but is never held back.
      // A `-p` run or the SDK has nobody watching, so it is never held back either
      isGateArmed = !isCommand(text) && isInteractive && gateGaveUpTurns < GATE_RESTS_AFTER
      const startedAt = await $.clock.now()
      failures = 0
      lastError = undefined
      await edit($, () => newJob(startedAt, 'Your request'))
      if (isInteractive && (await read($, enabled))) $.clock.after(1, () => void nameJob($, text, startedAt).catch(() => {}))
    }

    return next(e)
  })

  // Typing a slash command: the box steps down to its title row while the draft starts with '/',
  // so the command menu fits on screen; it comes back as soon as the draft changes
  on('prompt.edit', async ($, e, next) => {
    // Worked out from the edit itself, before the engine applies it, so the box shrinks in the same
    // frame the command menu opens; waiting for next(e) let the menu draw first under a full box,
    // pushing the box's top off the screen and into the scrollback
    try {
      const after = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
      const isSlash = after.trimStart().startsWith('/')
      // The engine opens the command menu on its own frame, whatever this hook waits for (measured
      // live: holding the keystroke until the shrunk box was drawn changed nothing), so the box
      // shrinks as early as it can and the keystroke is never held up
      pendingDraft = isSlash ? after : null
      await setDraftIsCommand($, isSlash)
    } catch {
      // Settled below from the engine's answer
    }
    let result
    try {
      result = await next(e)
    } finally {
      pendingDraft = null
    }
    try {
      const text = typeof (result as { text?: unknown } | undefined)?.text === 'string' ? (result as { text: string }).text : ''
      await setDraftIsCommand($, text.trimStart().startsWith('/'))
    } catch {
      // The box keeps its size
    }
    return result
  }).catch(($, e, next) => next(e))

  // Messages: each prompt the person sends, counted when they press Enter (even mid-turn), never a
  // notice, peer, plugin or slash command
  on('prompt.submit', async ($, e, next) => {
    try {
      const text = e.text.trim()
      const isHuman = HUMAN_ORIGINS.has(e.origin.kind)
      if (e.turnId === undefined) {
        // An idle prompt: the turn it starts is the person's only if they sent it
        nextTurnIsHuman = isHuman
      } else if (isHuman && text !== '' && !isCommand(text) && (await isBackgroundTurn($))) {
        // The person typed into a turn a notice started: from here it is their request. A slash
        // command typed then runs on its own, so it leaves the card (and Haiku) alone
        await setBackgroundTurn($, false)
        const startedAt = await $.clock.now()
        failures = 0
        lastError = undefined
        wasRefused = false
        await edit($, () => newJob(startedAt, 'Your request'))
        if (isInteractive && (await read($, enabled))) $.clock.after(1, () => void nameJob($, text, startedAt).catch(() => {}))
      }
    } catch {
      // One message goes uncounted; the prompt still goes
    }

    // The draft is gone once sent, so the box comes back whole. Cleared before next(e): a command
    // like /reload-plugins replaces this plugin inside next, so a clear after it never lands
    await setDraftIsCommand($, false).catch(() => {})
    const result = await next(e)
    const isDropped = Boolean((result as { drop?: unknown } | undefined)?.drop)
    // A prompt that was dropped starts no turn, so its sender must not carry over to the next one
    if (isDropped) nextTurnIsHuman = null
    // Counted once it is really sent; the transcript corrects the count at the next scan
    try {
      const text = e.text.trim()
      if (!isDropped && HUMAN_ORIGINS.has(e.origin.kind) && text !== '' && !isCommand(text) && !isNotTyped(text)) {
        await addLive($, { messages: 1 })
      }
    } catch {
      // The next scan counts it
    }
    return result
  }).catch(($, e, next) => next(e))

  on('classic.Notification', async ($, e, next) => {
    try {
      if (e.notification_type === 'permission_prompt' || /permission/i.test(e.message)) {
        await edit($, c =>
          c !== null && isLive(c)
            ? { ...c, phase: 'needs-you', needsYouReason: PERMISSION_REASON }
            : c,
        )
      }
    } catch {
      // The card misses one notice; the turn goes on
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.StopFailure', async ($, e, next) => {
    lastError = { kind: e.error, details: e.error_details ?? e.last_assistant_message ?? '' }

    return next(e)
  }).catch(($, e, next) => next(e))


  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const isMain = e.agentId === undefined
    const input = e as unknown as Record<string, unknown>
    // Any tool call, from any loop, comes after an answered permission prompt
    if (tool !== 'AskUserQuestion') await clearPermission($)

    if (tool === PLAN_TOOL) {
      gateGaveUpTurns = 0
      const steps = Array.isArray(input['steps'])
        ? input['steps'].filter((s): s is string => typeof s === 'string' && s.trim() !== '')
        : []
      if (steps.length === 0) return { deny: 'plan_steps needs 1 to 8 step names.' }
      const planned = planFrom(steps)
      if (isMain) await setTasks($, () => planned, true)

      return { result: `Planned ${planned.length} steps. The first one has started.` }
    }

    if (tool === PROGRESS_TOOL) {
      const name = typeof input['task'] === 'string' ? input['task'] : ''
      const rawStep = Number(input['step'])
      const step = Number.isInteger(rawStep) ? rawStep : undefined
      const percent = Math.max(0, Math.min(100, Math.round(Number(input['percent']) || 0)))
      const current = await read($, checklist)
      if (isMain && current !== null && isLive(current)) await setTasks($, tasks => applyProgress(tasks, name, percent, step))

      return { result: `Progress noted: ${percent}%.` }
    }

    // For the news line: what each agent is doing, and the files this job changed (from any loop)
    const job = await read($, checklist)
    if (job !== null && isLive(job)) {
      await noteJob($, job.startedAt)
      if (e.agentId !== undefined) {
        const seen = news.helpers.get(e.agentId)
        const at = await $.clock.now()
        const target = agentTarget(input)
        const isNew = seen?.tool !== tool || seen?.target !== target
        news.helpers.set(e.agentId, {
          ...seen,
          description: seen?.description ?? '',
          status: seen?.status ?? 'running',
          doing: doingOf(tool),
          tool,
          target,
          uses: (seen?.uses ?? 0) + 1,
          startedAt: seen?.startedAt ?? at,
          doingSince: isNew ? at : (seen?.doingSince ?? at),
          listed: seen?.listed ?? false,
        })
      }
      const path = input['file_path'] ?? input['notebook_path']
      if ((tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') && typeof path === 'string' && path) news.files.add(path)
    }

    if (!isMain) return next(e)

    // A model that keeps its own to-do list has planned, even with an empty or update-only call
    if (tool === 'TodoWrite' || tool === 'TaskCreate' || tool === 'TaskUpdate') isGateArmed = false
    const before = await read($, checklist)
    // Only a live job the person started, before its plan, while the model can reach plan_steps, is
    // gated; everything else fails open
    const isGated =
      isGateArmed && planToolOffered !== false && before !== null && isLive(before) && !hasRealPlan(before) && !(await isBackgroundTurn($))
    if (isGated && !ALWAYS_ALLOWED.has(tool) && (await read($, enabled))) {
      // The gate asks twice, then gives up for the turn, so a model that cannot plan is never stuck
      if (gateDenials < GATE_GIVES_UP) {
        gateDenials++
        return { deny: GATE_MESSAGE }
      }
      isGateArmed = false
      gateGaveUpTurns++
    }

    if (tool === 'AskUserQuestion') {
      await edit($, c => (c !== null && isLive(c) ? { ...c, phase: 'needs-you', needsYouReason: 'Claude has a question for you' } : c))
    } else if (before?.phase === 'needs-you') {
      await edit($, c => (c !== null && isLive(c) ? { ...c, phase: 'working', needsYouReason: null } : c))
    }

    const ran = await next(e)
    if (ran.deny !== undefined) return ran

    if (ran.isError === true) {
      // The tool answered, so a permission prompt is over either way
      await edit($, c => (c !== null && c.phase === 'needs-you' ? { ...c, phase: 'working', needsYouReason: null } : c))
      if (LOOKUP_TOOLS.has(tool)) return ran
      if (USER_SAID_NO.test(ran.text ?? '')) {
        failures = 0
        wasRefused = true
        await edit($, c =>
          c !== null && isLive(c) ? { ...c, phase: 'stuck', needsYouReason: null, stuckReason: SAID_NO_REASON } : c,
        )
      } else if (++failures >= STUCK_AFTER) {
        await edit($, c =>
          c !== null && isLive(c)
            ? { ...c, phase: 'stuck', needsYouReason: null, stuckReason: 'a step keeps failing, Claude is trying another way' }
            : c,
        )
      }

      return ran
    }

    failures = 0
    await edit($, c =>
      c !== null && isLive(c) && (c.phase === 'stuck' || c.phase === 'needs-you')
        ? { ...c, phase: 'working', stuckReason: null, needsYouReason: null }
        : c,
    )

    if (e.tool === 'TodoWrite') {
      await setTasks($, old =>
        e.todos.map((t, i) => {
          const name = cleanName(t.content)
          const status = fromTodoStatus(t.status)
          const known = old.find(o => o.name === name && o.hasReported)
          const percent = status === 'done' ? 100 : known !== undefined && status === 'active' ? known.percent : 0

          return { id: `todo-${i}`, name, status, percent, hasReported: known?.hasReported === true && status === 'active' }
        }),
      )
    } else if (e.tool === 'TaskCreate') {
      const created = (ran.result as { task?: { id?: string } } | undefined)?.task
      if (created?.id !== undefined) {
        const id = created.id
        // A new task waits until Claude marks it in progress
        await setTasks($, old => [...old, task(`task-${id}`, cleanName(e.subject), 'upcoming')])
      }
    } else if (e.tool === 'TaskUpdate') {
      const id = `task-${e.taskId}`
      const status = e.status
      const subject = e.subject
      await setTasks($, old => {
        if (status === 'deleted') return startNext(old.filter(t => t.id !== id))
        const changed = old.map(t => {
          if (t.id !== id) return t
          const name = subject === undefined ? t.name : cleanName(subject)
          if (status === undefined) return { ...t, name }
          const mapped = fromTodoStatus(status)

          return { ...t, name, status: mapped, percent: mapped === 'done' ? 100 : t.percent }
        })

        return status === 'completed' ? startNext(changed) : changed
      })
    }

    return ran
  }).catch(($, e, next) => {
    // A failed hook never blocks a tool: ours still answer, every other one runs
    if (next.called) return next(e)
    const tool = String(e.tool)
    // Nothing was stored, so the model is told, and can send it again
    if (tool === PLAN_TOOL) return { deny: 'Clawd View could not save the plan just now. Call plan_steps again.' }
    if (tool === PROGRESS_TOOL) return { deny: 'Clawd View could not save that progress just now. Call report_progress again.' }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      // An agent's turn ending: finished, in case the list no longer holds it
      const seen = news.helpers.get(e.agentId)
      if (seen?.status === 'running') news.helpers.set(e.agentId, { ...seen, status: 'completed', endedAt: seen.endedAt ?? (await $.clock.now()) })
      return next(e)
    }
    // The turn's replies are in the transcript now: read it back as the authority
    isMainTurnRunning = false
    queueRescan($)
    try {
      await closeJob($, e.reason, e.answer)
    } catch {
      // Whatever failed, the card must not keep saying Working
      await finishDone($, await $.clock.now()).catch(() => {})
    }
    lastError = undefined
    failures = 0
    wasRefused = false

    return next(e)
  }).catch(($, e, next) => next(e))

  // A tool's progress row only appears once the tool really runs, so an approved command's
  // permission prompt is over even when the command itself runs for minutes. (The terminal draws
  // this row; elsewhere the prompt clears when the tool answers or the next tool starts.) A render
  // never writes, so the card is changed just after this draw
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    $.clock.after(1, () => void clearPermission($).catch(() => {}))
    return next(e)
  })



  on('ui.render', { component: ['ToolUse', 'ToolResult', 'ToolGroup'] }, async ($, e, next) => {
    const isExpanded = e.component === 'ToolGroup' && e.props.isExpanded
    if (isExpanded || !(await read($, enabled))) return next(e)
    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) =>
    (await read($, enabled)) ? next({ ...e, props: { ...e.props, hint: '' } }) : next(e),
  )

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) =>
    (await read($, enabled)) ? next({ ...e, props: { ...e.props, tail: 'Clawd View' } }) : next(e),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Remembered for the side panel, which only opens in fullscreen
    sawFullscreen = e.viewport?.isFullscreen === true
    bandSurface = e.surface
    if (e.props.hasSurvey) return next(e)
    const isOn = await read($, enabled)
    const c = await read($, checklist)
    if (isOn && c === null) return next(e)
    const rest = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)

    // Off: only the button stays, so one click turns it back on.
    if (!isOn || c === null) {
      const toggle = (
        <Button
          key="toggle"
          plain
          label={isOn ? '● Clawd View' : '○ Clawd View: off'}
          onPress={async () => {
            await setEnabled($, !isOn)
            $.ui.toast(isOn ? 'Clawd View off: every step shows again' : 'Clawd View on: technical details hidden')
          }}
        />
      )

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="flex-end">
            {toggle}
          </Box>
          {rest}
        </Box>
      )
    }

    // Fullscreen or the desktop app with the side panel showing: the box lives there, the band
    // keeps only what the others draw (Clawd)
    const isFullscreen = e.viewport?.isFullscreen === true
    if ((isFullscreen || e.surface === 'desktop') && (await isPanelShown($))) return rest
    const canPanel = isFullscreen && e.surface === 'terminal'

    return (await drawCard($, $.ui.resolve(e), c, rest, {
      bodyColumns: e.props.bodyColumns,
      maxRows: e.props.maxRows,
      isFullscreen,
      surface: e.surface,
      inPane: false,
      canPanel,
      isWorking: e.props.isWorking === true,
    })) as RenderElement
  })

  // The side panel: the same box at full height, docked beside a fullscreen transcript
  on('ui.render', { component: 'Pane', requestId: PANEL_ID }, async ($, e) => {
    const els = $.ui.resolve(e)
    const c = await read($, checklist)
    if (!(await read($, enabled)) || c === null) return <els.Text dimColor>No task running.</els.Text>

    return (await drawCard($, els, c, null, {
      bodyColumns: e.props.bodyColumns,
      maxRows: e.props.scroll.bodyRows,
      isFullscreen: true,
      surface: e.surface,
      inPane: true,
      canPanel: false,
    })) as RenderElement
  })

  // Closed by hand: this job's panel stays shut (the next job asks again)
  on('ui.close', { id: PANEL_ID }, async ($, e, next) => {
    const closed = await next(e)
    if (e.origin.kind === 'person') panelClosedFor = (await read($, checklist))?.startedAt ?? null
    return closed
  }).catch(($, e, next) => next(e))

  registerStatus(on)
}

type CardLayout = {
  bodyColumns: number
  // Above the prompt: the band's maxRows; in the panel: the pane's body rows
  maxRows: number
  isFullscreen: boolean
  surface: string
  inPane: boolean
  // A fullscreen band offers the side panel with a button
  canPanel: boolean
  // While Claude works: Clawd and next-steps step aside, the spinner and its tip sit above
  isWorking?: boolean
}

/** The Clawd View box, drawn above the prompt or in the side panel. */
async function drawCard(
  $: Engine,
  { Box, Text, Button, Svg }: { Box: any; Text: any; Button: any; Svg?: any },
  c: Checklist,
  rest: RenderChildren | null,
  L: CardLayout,
): Promise<RenderChildren> {
  const isOn = true
    const toggle = (
      <Button
        key="toggle"
        plain
        label={isOn ? '● Clawd View' : '○ Clawd View: off'}
        onPress={async () => {
          await setEnabled($, !isOn)
          $.ui.toast(isOn ? 'Clawd View off: every step shows again' : 'Clawd View on: technical details hidden')
        }}
      />
    )

    const panelButton = (
      <Button key="panel" plain dimColor label="  ▸ Panel" onPress={() => void openPanel($, true)} />
    )

    // The desktop app hands out new handles for every element on each redraw and drops a press
    // that arrives after one, so there the card never follows the frame clock: the working bar's
    // wave moves inside its Svg, the title holds one color, and the elapsed time moves on with
    // the figures' clock (every few seconds)
    const isDesktop = L.surface === 'desktop'
    const frame = isDesktop ? 0 : await read($, tick)
    const now = await $.clock.now()
    const width = L.bodyColumns
    const inner = Math.max(20, width - 4)

    const total = c.tasks.length
    const done = c.tasks.filter(t => t.status === 'done').length
    const activeAt = c.tasks.findIndex(t => t.status === 'active')
    const stepNo = activeAt !== -1 ? activeAt + 1 : Math.min(total, done + 1)
    const overall = total === 0
      ? 0
      : Math.round(c.tasks.reduce((sum, t) => sum + (t.status === 'done' ? 100 : t.status === 'active' ? t.percent : 0), 0) / total)
    const elapsed = formatDuration((c.finishedAt ?? now) - c.startedAt)

    const frameColor =
      c.phase === 'stopped' ? 'gray' : CARD_ORANGE

    const title = (
      <Text wrap="truncate-end">
        <Text color={CARD_ORANGE}>✻ </Text>
        {isDesktop ? (
          <Text bold color={CARD_ORANGE}>
            {c.title}
          </Text>
        ) : (
          [...c.title].map((ch, i, all) => (
            <Text key={`t${i}`} bold color={titleShade(i, frame, all.length)}>
              {ch}
            </Text>
          ))
        )}
      </Text>
    )
    const headline =
      c.phase === 'needs-you' ? (
        <Text wrap="truncate-end">
          <Text backgroundColor={CARD_ORANGE} color="#000000" bold>
            {' Needs you '}
          </Text>{' '}
          {c.needsYouReason ?? 'Claude needs you'}
        </Text>
      ) : c.phase === 'stuck' ? (
        <Text color={CARD_ORANGE} wrap="truncate-end">
          ⚠ Stuck: {c.stuckReason ?? 'something went wrong, try again'}
        </Text>
      ) : c.phase === 'stopped' ? (
        <Text wrap="truncate-end">■ Stopped · {c.title} · you pressed Esc</Text>
      ) : c.phase === 'done' ? (
        <Text color={DONE_ORANGE} bold wrap="truncate-end">
          ✓ All done · {c.title} · took {elapsed}
        </Text>
      ) : (
        title
      )
    const split = (left: RenderChildren, right: RenderChildren) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexShrink={1}>{left}</Box>
        <Box flexShrink={0} marginLeft={1}>
          {right}
        </Box>
      </Box>
    )
    // How tall the box may be. The person chose every step of the plan and the full info block
    // (a long plan may make the live area taller than the screen); only a genuinely tiny terminal
    // gets the compact or one-line box. In fullscreen maxRows is what is left above the prompt and
    // the box windows its steps to it; in the side panel the pane's rows are the room
    const isFullscreen = L.isFullscreen
    const isMain = !L.inPane && !isFullscreen && !isDesktop
    const restRows = countRows(rest)
    // On the main screen the whole live area must fit on the screen: rows pushed past its top go
    // into the terminal's history and can't be erased, so every later redraw leaves a cut-off copy
    // of the box behind. The box takes the smaller of its working and between-turns room, so its
    // height holds steady across a turn, less what clawd.js draws beside us: at least Clawd's rows
    // while he is in the band, only what is there once he is hidden (/clawd hidden)
    const clawdRows = L.surface === 'terminal' && L.maxRows >= CLAWD_MIN_TERMINAL_ROWS && hasMascot(rest) ? CLAWD_ROWS : 0
    const restTaken = Math.max(restRows, clawdRows)
    // The footer grows by a row an agent while background agents are listed in it
    const mainRoom = mainScreenRoom(L.maxRows, isMain ? await runningAgents($) : 0)
    const mainCap = Math.min(mainRoom.work, mainRoom.idle) - restTaken
    const boxCap = L.inPane ? L.maxRows : isFullscreen ? L.maxRows - restRows : mainCap
    // On the main screen the info block sits at the bottom of the box, working or done, in the rows
    // its steps leave (in full or not at all): every step comes first. Fullscreen and the side panel
    // always hold it; /clawd-stats prints it into the conversation
    const isDoneHere = isMain && c.phase === 'done'
    // The desktop app's card grows to fit and leaves nothing behind, so there the box keeps every
    // step and the full figures, as the side panel does
    const isRoomy = L.inPane || isDesktop
    const drawn = L.surface === 'terminal' || isDesktop ? await statusRow($, { Box, Text, Svg }, inner, undefined, isDesktop, L.inPane) : null
    // The side panel and the desktop card always have a full block: two columns when wide, else
    // every fact on its own line
    const fullInfo = drawn === null ? null : (drawn.full ?? (isRoomy ? drawn.stacked : null))
    // The news line under the steps: agents, warnings and the finished job's summary, one at a time
    const newsNow = await currentNews($, c, now, isAnimated(c), isDesktop ? STATUS_TICK_MS : NEWS_MS, isRoomy)
    // The tier depends on the terminal's size and the plan's length, never on the job's state.
    // On the main screen: the steps line and at least one step in the border, else fewer rows.
    // In fullscreen the full figures only with room for every step under them
    const tier: Tier = isRoomy
      ? 'full'
      : isMain
        ? (boxCap >= 5 ? 'condensed' : boxCap >= 4 ? 'compact' : 'line')
        : pickTier(boxCap, fullInfo != null, total + (newsNow ? 1 : 0))
    // A finished job's box: every step first (border, title, steps line and the steps), the figures
    // in what is left
    // (between turns: the room then, not the smaller of working and between-turns room)
    // (a finished box while a new turn runs, before its plan arrives, has the working room)
    const doneCap = (L.isWorking ? mainRoom.work : mainRoom.idle) - restTaken
    // The news takes its row only where a step still fits beside it (border, title, steps line)
    const newsRows = newsNow && tier !== 'compact' && tier !== 'line' && (isRoomy || (isDoneHere ? doneCap : boxCap) - 4 - 1 >= 1) ? 1 : 0
    const left = (isDoneHere ? doneCap : boxCap) - 4 - total - newsRows
    // The figures show in full or not at all
    const info = drawn === null
      ? null
      : isDesktop
        ? fullInfo
        : isMain
        ? (tier === 'line' || tier === 'compact' ? null : fullInfo !== null && left >= fullInfo.rows ? fullInfo : null)
        : tier === 'full' ? fullInfo : null
    const status = info?.node ?? null
    const statusRows = info?.rows ?? 0
    const card = (body: RenderChildren) => (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={frameColor} paddingX={1}>
          {body}
          {status}
        </Box>
        {rest}
      </Box>
    )

    const stepLine =
      c.phase === 'done' ? `${total} of ${total} steps done` : `Step ${stepNo} of ${total}`

    // One line, no border: for too little room, and while a slash command is typed
    const oneLine = (lineRest: RenderChildren | null) => {
      const word = c.phase === 'done' ? '✓ All done' : c.phase === 'needs-you' ? 'Needs you' : c.phase === 'stuck' ? '⚠ Stuck' : c.phase === 'stopped' ? '■ Stopped' : '✻'
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Box flexShrink={1}>
              <Text color={c.phase === 'stopped' ? 'gray' : CARD_ORANGE} wrap="truncate-end">
                {word} · {c.phase === 'done' ? c.title : c.tasks[activeAt]?.name ?? c.title} · {stepLine} · {c.phase === 'done' ? 100 : overall}%
              </Text>
            </Box>
            {L.canPanel ? <Box flexShrink={0}>{panelButton}</Box> : null}
          </Box>
          {lineRest}
        </Box>
      )
    }
    // A slash command being typed in the terminal: the command menu opens under the prompt, about
    // half the terminal tall. The box steps down to one line and, on the main screen, gives Clawd's
    // rows back too, so the menu fits on the screen. Only while the draft really starts with '/',
    // so a flag left over from a sent command never keeps the box small. The desktop app has no
    // such menu under the prompt: there the box stays whole
    if (!L.inPane && !isDesktop && (await isSlashDraft($))) {
      if (!isMain) return oneLine(boxCap < 1 ? null : rest)
      const menuRoom = Math.min(mainRoom.work, mainRoom.idle) + MENU_SPARE_ROWS - menuRows(L.maxRows)
      return menuRoom >= 1 ? oneLine(null) : null
    }
    // Too little room for a box. In fullscreen with no row left beside the others, the line takes
    // their place: the band never asks for more rows than it has
    if (tier === 'line') return oneLine(isFullscreen && boxCap < 1 ? null : rest)

    const rowRoom = inner
    // A narrow card drops the bars before the step names get too short to read
    const METER = rowRoom - (2 + 2 + meterWidth(inner) + 2 + 7) >= 4 ? meterWidth(inner) : 0
    const nameWidth = Math.max(4, rowRoom - (2 + 2 + METER + 2 + 7))
    // Measured in terminal cells, so wide characters and emoji never push a row onto two lines
    const fit = (name: string) => fitCells(name, nameWidth)
    const firstUpcoming = c.tasks.findIndex(t => t.status === 'upcoming')
    // As many steps as the room left holds, the window sliding to keep the step being worked on in
    // view (the steps line still counts them all); the side panel and the desktop card show every step
    const showStepLine = tier !== 'compact'
    const stepRoom = isRoomy ? total : (isDoneHere ? doneCap : boxCap) - 2 - 1 - (showStepLine ? 1 : 0) - statusRows - newsRows
    const room = Math.max(1, Math.min(total, stepRoom))
    // The step being worked on, else the first one not done yet
    const open = c.tasks.findIndex(t => t.status !== 'done')
    const anchor = activeAt !== -1 ? activeAt : open === -1 ? total : open
    // One step above the anchor when there's room for it, else the anchor first; steps left out
    // are counted in a row at the top and the bottom, so a short window never hides them silently
    const win = stepWindow(total, anchor, room)
    const start = win.start
    const hiddenDone = c.tasks.slice(0, win.above).every(t => t.status === 'done' || c.phase === 'done')

    // Each column in a box of its own fixed width, not padded with spaces: the desktop app draws
    // in a font whose letters differ in width, where only boxes line the bars up; the terminal
    // draws them the same either way
    const column = (width: number, children: RenderChildren) => (
      <Box width={width} flexShrink={0} overflow="hidden" flexDirection="row" alignItems="center">
        {children}
      </Box>
    )
    // The word after a bar (Done, Working, a percent, Next), two cells after it: a margin, not
    // spaces, so it starts where the steps line's percent does in a proportional font too
    const label = (children: RenderChildren) => (
      <Box flexShrink={0} marginLeft={2}>
        {children}
      </Box>
    )
    // A bar of these colors, one a cell: an Svg on the desktop app, the text glyphs elsewhere.
    // Nothing at all with no cells: the engine refuses an Svg 0 pixels wide
    const barOf = (colors: string[], text: RenderChildren, alt: string, isWave = false) =>
      colors.length === 0 ? null : isDesktop && Svg ? (
        <Svg
          source={barSvg(colors, isWave)}
          alt={alt}
          width={svgPx(colors.length * DESKTOP_CELL_PX)}
          height={svgPx(DESKTOP_BAR_PX)}
          {...(isWave ? { isInteractive: true } : {})}
        />
      ) : (
        text
      )
    const nameColumn = 2 + nameWidth + 2

    const plural = (n: number) => `${n} step${n === 1 ? '' : 's'}`
    const aboveRow = win.above > 0 ? (
      <Box key="above" flexDirection="row">
        <Text wrap="truncate-end">
          {hiddenDone
            ? <Text color={DONE_ORANGE}>✓ {plural(win.above)} done</Text>
            : <Text dimColor>↑ {plural(win.above)} above</Text>}
        </Text>
      </Box>
    ) : null
    const belowRow = win.below > 0 ? (
      <Box key="below" flexDirection="row">
        <Text wrap="truncate-end">
          <Text color={CARD_ORANGE}>+ </Text>
          <Text dimColor>{win.below} more step{win.below === 1 ? '' : 's'}</Text>
        </Text>
      </Box>
    ) : null

    const rows = c.tasks.slice(start, win.end).map((t, offset) => {
      const index = start + offset
      if (t.status === 'done' || c.phase === 'done') {
        return (
          <Box key={t.id} flexDirection="row">
            {column(nameColumn, [
              <Text key="m" color={DONE_ORANGE}>✓ </Text>,
              <Text key="n" dimColor wrap="truncate-end">{fit(t.name)}  </Text>,
            ])}
            {column(METER, barOf(Array<string>(METER).fill(DONE_ORANGE), <Text color={DONE_ORANGE} wrap="truncate-end">{BAR.repeat(METER)}</Text>, 'Step done'))}
            {label(<Text color={DONE_ORANGE}>Done</Text>)}
          </Box>
        )
      }
      if (t.status === 'active') {
        // A smooth wave of orange, light to deep and back, repeated along the whole bar and
        // sliding right two cells a frame. Each cell's color is blended, so no shade jumps in.
        // The percent, when Claude gives one, is the words beside it. While the job stands still
        // (stopped, paused) the desktop's wave stands still too
        const cells = Array.from({ length: METER }, (_, i) => ({ ch: BAR, color: smoothShade(i - frame * WAVE_SPEED) }))

        return (
          <Box key={t.id} flexDirection="row">
            {column(nameColumn, [
              <Text key="m" color={CARD_ORANGE}>{c.phase === 'needs-you' ? '‖ ' : '● '}</Text>,
              <Text key="n" bold wrap="truncate-end">{fit(t.name)}  </Text>,
            ])}
            {column(
              METER,
              barOf(
                cells.map(cell => cell.color ?? EMPTY_BAR),
                cells.map((cell, i) => (
                  <Text key={`m${i}`} color={cell.color} dimColor={cell.color === undefined} wrap="truncate-end">
                    {cell.ch}
                  </Text>
                )),
                'Step in progress',
                isAnimated(c),
              ),
            )}
            {label(
              <Text color={CARD_ORANGE} bold>
                {c.phase === 'stopped' ? 'Stopped' : !isAnimated(c) ? 'Paused' : t.hasReported ? `${t.percent}%` : 'Working'}
              </Text>,
            )}
          </Box>
        )
      }

      return (
        <Box key={t.id} flexDirection="row">
          {column(nameColumn, <Text dimColor wrap="truncate-end">○ {fit(t.name)}  </Text>)}
          {column(METER, barOf(Array<string>(METER).fill(EMPTY_BAR), <Text color={EMPTY_BAR} wrap="truncate-end">{BAR.repeat(METER)}</Text>, 'Step not started'))}
          {label(<Text dimColor>{index === firstUpcoming ? 'Next' : 'Up next'}</Text>)}
        </Box>
      )
    })

    // The agent line: the model's badge (it breathes while the agent works), the agent's name in
    // its kind's color, what it is doing typed in as it starts, and its tokens and time on the
    // right. The desktop card redraws only on change, so there it holds still and shows it whole
    // Named `ag`, not `h`: `h` is the JSX factory here
    const agentRow = (ag: NewsHelper, place: string | undefined) => {
      const model = ag.model ?? 'model'
      const modelColor = MODEL_COLORS[model] ?? OTHER_MODEL_COLOR
      const isLive = ag.status === 'running'
      const moves = !isDesktop && isAnimated(c)
      const breath = moves && isLive ? (Math.sin(frame / 4) * 0.5 + 0.5) * 0.35 : 0
      const badge =
        ag.status === 'completed' ? { text: ` ${model} ✓ `, bg: AGENT_DONE, ink: BADGE_INK }
          : ag.status === 'failed' ? { text: ` ${model} ✗ `, bg: AGENT_FAILED, ink: BADGE_INK }
          : ag.status === 'killed' ? { text: ` ${model} ■ `, bg: AGENT_STOPPED, ink: '#eadfd9' }
          : ag.status === 'idle' || ag.status === 'waiting' ? { text: ` ${model} ‖ `, bg: mixHex(modelColor, BADGE_INK, 0.35), ink: BADGE_INK }
          : { text: ` ${model} `, bg: mixHex(modelColor, '#fff5f0', breath), ink: BADGE_INK }
      // Its own name, else the few words Claude gave it, else its kind
      const name = ag.name?.trim() || ag.description?.trim() || ag.kind?.trim() || 'agent'
      const action = agentAction(ag)
      // About 4 letters a frame, from when this action began
      const typedTo = moves && isLive && ag.doingSince !== undefined ? Math.max(0, Math.floor((now - ag.doingSince) / FRAME_MS) * 4) : action.length
      const shown = [...action].slice(0, typedTo).join('')
      const caret = moves && isLive ? (frame % 4 < 2 ? '▌' : ' ') : ''
      const tokens = ag.tokens ? `↑ ${agentTokens(ag.tokens)}` : ''
      const rest = [
        ...(ag.startedAt !== undefined ? [formatDuration((ag.endedAt ?? now) - ag.startedAt)] : []),
        ...(place ? [place] : []),
      ].join(' · ')
      return (
        <Box key="news" flexDirection="row">
          <Box flexShrink={1} flexGrow={1}>
            <Text wrap="truncate-end">
              <Text backgroundColor={badge.bg} color={badge.ink} bold>{badge.text}</Text>
              <Text> </Text>
              <Text color={AGENT_COLORS[ag.kind ?? ''] ?? OTHER_AGENT_COLOR} bold>{name}</Text>
              <Text color={ag.status === 'failed' ? AGENT_FAILED : undefined} dimColor={!isLive && ag.status !== 'failed'}>{` ${shown}`}</Text>
              {caret ? <Text color={CARD_ORANGE}>{caret}</Text> : null}
            </Text>
          </Box>
          {tokens || rest ? (
            <Box flexShrink={0} marginLeft={2}>
              <Text>
                {tokens ? <Text color={CARD_ORANGE} bold>{tokens}</Text> : null}
                {rest ? <Text dimColor>{tokens ? ` · ${rest}` : rest}</Text> : null}
              </Text>
            </Box>
          ) : null}
        </Box>
      )
    }

    // Compact: the headline and the step rows only, no steps line, when the info block has no room
    const body = (
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {split(
          headline,
          <Box flexDirection="row">
            {inner >= 30 && c.phase !== 'done' ? <Text dimColor>{elapsed}  </Text> : null}
            {toggle}
            {L.canPanel ? panelButton : null}
          </Box>,
        )}
        {showStepLine ? (
          <Box flexDirection="row">
            {column(nameColumn + METER, <Text dimColor wrap="truncate-end">{stepLine}</Text>)}
            {label(
              <Text color={CARD_ORANGE} bold>
                {`${c.phase === 'done' ? 100 : overall}%`}
              </Text>,
            )}
          </Box>
        ) : null}
        {aboveRow}
        {rows}
        {belowRow}
        {newsRows && newsNow?.item.agent ? (
          agentRow(newsNow.item.agent, newsNow.place)
        ) : newsRows && newsNow ? (
          <Box key="news" flexDirection="row">
            <Box flexShrink={1} flexGrow={1}>
              <Text wrap="truncate-end">
                <Text color={newsNow.item.isAlert ? STATUS_DEEP : CARD_ORANGE} bold>{newsNow.item.mark} </Text>
                <Text bold={newsNow.item.isAlert}>{newsNow.item.text}</Text>
                {newsNow.item.detail ? <Text dimColor>{` · ${newsNow.item.detail}`}</Text> : null}
              </Text>
            </Box>
            {newsNow.dots ? (
              <Box flexShrink={0} marginLeft={2}>
                <Text dimColor>{newsNow.dots}</Text>
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Box>
    )

    return card(body)
}

/** Whether clawd.js drew the mascot (or its game) in what the band holds beneath the box. */
function hasMascot(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(hasMascot)
  const n = node as { key?: unknown; props?: Record<string, unknown>; children?: unknown }
  const key = n.key ?? n.props?.key
  if (key === 'clawd' || key === 'clawd-game') return true
  return hasMascot(n.children ?? n.props?.children ?? null)
}

/** Background agents the footer lists: one row each (to its cap) and two more around them. */
async function runningAgents($: Engine): Promise<number> {
  try {
    const done = new Set(['completed', 'failed', 'killed'])
    return (await $.agent.list()).filter(a => !done.has(a.status)).length
  } catch {
    // No list to read: none counted
    return 0
  }
}

// --- The news line: one row under the steps that cycles through what agents do, warnings and,
// once done, a short summary ------------------------------------------------------------------

// How long each piece of news stays: the terminal's frame clock moves it on; the desktop card
// redraws with the figures' clock, so there it moves on with that
const NEWS_MS = 4_000
// Past this many items the dots become "3/9"
const NEWS_DOTS_MAX = 6

export type NewsHelper = {
  description: string
  status: string
  doing?: string
  // What the agent is called, its kind (Explore, Plan…) and the model it runs on, when known
  name?: string
  kind?: string
  model?: string
  // Its context in tokens at its last step, its tool calls so far, the tool and what it works on
  tokens?: number
  uses?: number
  tool?: string
  target?: string
  // When it was first seen, when its current action began, and when it stopped
  startedAt?: number
  doingSince?: number
  endedAt?: number
  // False until Claude Code's agent list names it: the engine's own forks (compaction, memory)
  // run loops with ids no list names, and they are no agents of the person's
  listed?: boolean
}
export type NewsItem = { mark: string; text: string; detail?: string; isAlert: boolean; agent?: NewsHelper }

// The agent line: each model has one color, on its badge, and each kind of agent another, on its
// name. Models are cool colors and agents warm ones, so the two never look alike
export const MODEL_COLORS: Record<string, string> = { haiku: '#5cc8e6', sonnet: '#6f9dff', opus: '#b48cff' }
export const OTHER_MODEL_COLOR = '#9aa4b2'
export const AGENT_COLORS: Record<string, string> = { Explore: '#ff8fb8', Plan: '#f5c85a', 'general-purpose': '#f3e9df', 'code-reviewer': '#cfe86a' }
export const OTHER_AGENT_COLOR = '#d9b48f'
const AGENT_DONE = '#3fc06a'
const AGENT_FAILED = '#ff5a36'
const AGENT_STOPPED = '#6b5d56'
const BADGE_INK = '#1b1512'

/** A model id as the badge's word: "haiku", "sonnet", "opus", else the family name after "claude-". */
export function shortModel(id: string | undefined): string | undefined {
  if (!id) return undefined
  const known = /(haiku|sonnet|opus)/i.exec(id)
  if (known) return known[1]!.toLowerCase()
  const family = /^claude-([a-z]+)/i.exec(id)
  return family ? family[1]!.toLowerCase() : undefined
}

/** What a tool call works on, in a few characters: a file's name, a search, a command's first word. */
export function agentTarget(input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const path = str('file_path') || str('notebook_path')
  if (path) return path.split('/').pop() ?? path
  if (str('pattern')) return str('pattern')
  if (str('command')) return str('command').trim().split(/\s+/).slice(0, 2).join(' ')
  if (str('url')) return str('url').replace(/^https?:\/\//, '').split('/')[0] ?? ''
  if (str('query')) return str('query')
  return ''
}

/** Tokens, short: 940, 12.4k, 184k, 1.2M. */
export function agentTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return shortCount(n)
}

/** What the agent is doing, in plain words: "reading checkout.ts", "thinking", "waiting for you". */
export function agentAction(h: NewsHelper): string {
  if (h.status === 'completed') return 'finished'
  if (h.status === 'failed') return 'failed'
  if (h.status === 'killed') return 'stopped'
  if (h.status === 'idle' || h.status === 'waiting') return 'waiting'
  if (h.status === 'pending') return 'getting started'
  if (!h.tool) return h.doing ?? 'getting started'
  const verb = h.doing ?? doingOf(h.tool)
  if (!h.target) return verb
  // "reading files" becomes "reading checkout.ts"
  return `${verb.replace(/ (files|the code|the web|a command)$/, '')} ${h.target}`
}

const mixHex = (a: string, b: string, t: number) => rgbHex(mixRgb(hexRgb(a), hexRgb(b), t))

// The job on screen's agents and changed files, keyed by when it started, so a new job starts
// clean. `before` holds the agents already finished when it started: they are old news
const news = {
  jobAt: -1,
  before: new Set<string>(),
  helpers: new Map<string, NewsHelper>(),
  files: new Set<string>(),
  // Once the line has shown, it keeps its row to the job's end, so the box doesn't jump
  last: null as NewsItem | null,
}

async function noteJob($: Engine, jobAt: number): Promise<void> {
  if (news.jobAt === jobAt) return
  news.jobAt = jobAt
  news.helpers = new Map()
  news.files = new Set()
  news.last = null
  const list = await $.agent.list().catch(() => [])
  news.before = new Set(list.filter(a => a.status !== 'running' && a.status !== 'idle').map(a => a.id))
}

/** What a tool call says an agent is doing, in Clawd's words. */
export function doingOf(tool: string): string {
  if (tool === 'Read') return 'reading files'
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return 'editing files'
  if (tool === 'Bash') return 'running a command'
  if (tool === 'Grep' || tool === 'Glob') return 'searching the code'
  if (tool === 'WebSearch' || tool === 'WebFetch') return 'searching the web'
  return 'thinking'
}

/** The news, warnings first. A finished job gets one line that sums it up. */
export function newsItems(p: {
  helpers: NewsHelper[]
  files: string[]
  limits: { kind: string; percentUsed?: number }[]
  contextPct?: number
  isDone: boolean
}): NewsItem[] {
  const alerts: NewsItem[] = []
  for (const [kind, name] of [['five_hour', '5-hour'], ['seven_day', 'weekly']] as const) {
    const pct = p.limits.find(l => l.kind === kind)?.percentUsed
    if (pct !== undefined && pct > STATUS_HIGH_AT) alerts.push({ mark: '⚠', text: `${pct}% of your ${name} limit used`, isAlert: true })
  }
  if (p.contextPct !== undefined && p.contextPct > STATUS_HIGH_AT) {
    alerts.push({ mark: '⚠', text: `Context is ${p.contextPct}% full`, detail: 'older messages get summed up soon', isAlert: true })
  }
  const name = (h: NewsHelper) => h.name?.trim() || h.description?.trim() || h.kind?.trim() || 'An agent'
  const agents = p.helpers.filter(h => h.listed !== false)
  const failed = agents.filter(h => h.status === 'failed')
  const stopped = agents.filter(h => h.status === 'killed')
  const finished = agents.filter(h => h.status === 'completed')
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
  const fileNames = [...p.files].map(f => f.split('/').pop() ?? f)

  if (p.isDone) {
    const parts = [
      ...(fileNames.length ? [`Changed ${plural(fileNames.length, 'file')}`] : []),
      ...(finished.length ? [`${plural(finished.length, 'agent')} pitched in`] : []),
      ...(failed.length ? [`${failed.length} failed`] : []),
    ]
    const total = agents.reduce((sum, h) => sum + (h.tokens ?? 0), 0)
    if (parts.length && total > 0) parts.push(`↑ ${agentTokens(total)}`)
    const summary: NewsItem[] = parts.length ? [{ mark: failed.length ? '✗' : '✓', text: parts.join(' · '), isAlert: failed.length > 0 }] : []
    return [...summary, ...alerts]
  }

  return [
    ...failed.map(h => ({ mark: '✗', text: name(h), detail: 'failed', isAlert: true, agent: h })),
    ...alerts,
    // Starting up counts as at work; a teammate waiting for a message, or one waiting on you, waits
    ...agents.filter(h => h.status === 'running' || h.status === 'pending').map(h => ({ mark: '◐', text: name(h), detail: agentAction(h), isAlert: false, agent: h })),
    ...agents.filter(h => h.status === 'idle' || h.status === 'waiting').map(h => ({ mark: '‖', text: name(h), detail: 'waiting', isAlert: false, agent: h })),
    // Each finished agent gets its turn too, with its green badge
    ...finished.map(h => ({ mark: '✓', text: name(h), detail: 'finished', isAlert: false, agent: h })),
    ...stopped.map(h => ({ mark: '■', text: name(h), detail: 'stopped', isAlert: false, agent: h })),
  ]
}

/** The piece of news to show now, and where it sits among them ("● ○ ○" or "3/9"). */
export function pickNews(items: NewsItem[], at: number, isMoving: boolean, period = NEWS_MS): { item: NewsItem; dots: string; place?: string } | null {
  if (items.length === 0) return null
  // A finished box stands still: the summary (or the first warning) stays
  const i = isMoving ? Math.floor(at / period) % items.length : 0
  const dots = !isMoving || items.length === 1
    ? ''
    : items.length <= NEWS_DOTS_MAX
      ? items.map((_, k) => (k === i ? '●' : '○')).join(' ')
      : `${i + 1}/${items.length}`
  return { item: items[i]!, dots, ...(items.length > 1 ? { place: `${i + 1}/${items.length}` } : {}) }
}

/** The news line's item for this job now, reading the agents' list as it stands. */
// Warnings alone never open the line on the main screen: a reading arriving mid-task would make the
// box a row taller, and the stats' bars already turn deep orange past 80%. They join news already
// showing there, and always show on the desktop card and the side panel
async function currentNews($: Engine, c: Checklist, at: number, isMoving: boolean, period: number, canWarnAlone: boolean) {
  await noteJob($, c.startedAt)
  const list = await $.agent.list().catch(() => null)
  // An agent that has left Claude Code's list is no longer at work: it shows as finished, never
  // as running forever. Only when the list was read, not when reading it failed
  if (list !== null) {
    const ids = new Set(list.map(a => a.id))
    for (const [id, h] of news.helpers) {
      const isOpen = h.status === 'running' || h.status === 'pending' || h.status === 'idle' || h.status === 'waiting'
      if (h.listed && isOpen && !ids.has(id)) news.helpers.set(id, { ...h, status: 'completed', endedAt: h.endedAt ?? at })
    }
  }
  for (const a of list ?? []) {
    if (news.before.has(a.id)) continue
    const seen = news.helpers.get(a.id)
    const isOver = a.status === 'completed' || a.status === 'failed' || a.status === 'killed'
    news.helpers.set(a.id, {
      ...seen,
      description: a.description || a.name || a.type,
      name: a.name || undefined,
      kind: a.type || undefined,
      status: a.status,
      startedAt: seen?.startedAt ?? at,
      endedAt: isOver ? (seen?.endedAt ?? at) : undefined,
      listed: true,
    })
  }
  const { isOn, u, readings, t } = await readStatus($)
  const contextPct = u?.contextPercent
    ?? (u?.contextTokens !== undefined && u.contextWindow ? Math.min(100, Math.round((u.contextTokens / u.contextWindow) * 100)) : undefined)
  const base = {
    helpers: [...news.helpers.values()],
    files: [...news.files],
    isDone: c.phase === 'done',
  }
  const quiet = newsItems({ ...base, limits: [] })
  // With the stats switched off (/clawd-status off) their warnings stay off too
  const items = !isOn || (quiet.length === 0 && news.last === null && !canWarnAlone)
    ? quiet
    : newsItems({ ...base, limits: pickLimits(readings, t).map(l => ({ kind: l.kind, percentUsed: l.isFresh ? undefined : l.percentUsed })), contextPct })
  const picked = pickNews(items, at, isMoving, period)
  if (picked) news.last = picked.item
  // Shown once, the line keeps its row with its last news
  return picked ?? (news.last ? { item: news.last, dots: '' } : null)
}


// The status row: model, usage limits with their reset times, context and cost. It is drawn by
// Clawd View itself, on top of its box, so the two always appear and leave together.

const statusUsage = atom({ plugin: 'clawd-view', key: 'statusUsage' } as const, null)
const statusModel = atom({ plugin: 'clawd-view', key: 'statusModel' } as const, null)
const statusEffort = atom({ plugin: 'clawd-view', key: 'statusEffort' } as const, null)
const statusNow = atom({ plugin: 'clawd-view', key: 'statusNow' } as const, 0)
const statusZone = atom({ plugin: 'clawd-view', key: 'statusZone' } as const, null)
const statusIsOn = atom({ plugin: 'clawd-view', key: 'statusIsOn' } as const, true)
const statusTokens = atom({ plugin: 'clawd-view', key: 'statusTokens' } as const, { input: 0, output: 0 })
const statusMessages = atom({ plugin: 'clawd-view', key: 'statusMessages' } as const, 0)
const statusCacheAt = atom({ plugin: 'clawd-view', key: 'statusCacheAt' } as const, null)
const statusCacheTtl = atom({ plugin: 'clawd-view', key: 'statusCacheTtl' } as const, null)
const statusStartedAt = atom({ plugin: 'clawd-view', key: 'statusStartedAt' } as const, null)
const statusReadings = atom({ plugin: 'clawd-view', key: 'statusReadings' } as const, [])

// Input, Output and Messages: the transcript is the authority. The figures shown are the last scan of it
// plus what arrived live after that scan began, so nothing is counted twice and an over-count heals on
// the next scan
type Counts = { input: number; output: number; messages: number }
const ZERO: Counts = { input: 0, output: 0, messages: 0 }
let liveCounts: Counts = { ...ZERO }
let scanBase: Counts | null = null
let liveAtScan: Counts = { ...ZERO }
let scanSeq = 0
// Where the transcript is and how big it was at the last scan, so a grown one is read again
let transcriptPath: string | undefined
let transcriptSize = -1
// A main turn running: its replies are counted live, and the transcript is read again once it ends
let isMainTurnRunning = false
let isRescanQueued = false
let usageCacheReadAt = 0
let slowTick = 0
// The effort settings named when last read, so a /effort change shows before the next request
let settingsEffort: string | undefined
// The effort an environment variable sets; a settings change then leaves the figure alone
let envEffort: string | undefined

async function showCounts($: Engine): Promise<void> {
  const base = scanBase ?? ZERO
  const since = scanBase ? liveAtScan : ZERO
  await update($, statusTokens, () => ({
    input: Math.max(0, base.input + liveCounts.input - since.input),
    output: Math.max(0, base.output + liveCounts.output - since.output),
  }))
  await update($, statusMessages, () => Math.max(0, base.messages + liveCounts.messages - since.messages))
}

async function addLive($: Engine, add: Partial<Counts>): Promise<void> {
  liveCounts = {
    input: liveCounts.input + (add.input ?? 0),
    output: liveCounts.output + (add.output ?? 0),
    messages: liveCounts.messages + (add.messages ?? 0),
  }
  await showCounts($)
}

/** Reads the transcript again shortly, once; a burst of reasons makes one scan. */
function queueRescan($: Engine): void {
  if (isRescanQueued) return
  isRescanQueued = true
  $.clock.after(STATUS_RESCAN_DELAY_MS, () => {
    isRescanQueued = false
    void readHistory($)
  })
}

const STATUS_COMMAND = 'clawd-status'
// The first-run tip, shown once ever, and the guide /clawd-view help prints into the conversation
const WELCOME_STORE = 'welcomed'
const WELCOME_TIP = 'Clawd View is on. For the full view keep your window at least 35 lines tall and 106 wide. Type /clawd-view help for tips.'
const GUIDE = [
  '**Clawd View: getting the best view**',
  '',
  'Everything at the bottom of the terminal (the box, Clawd, the prompt and the footer) has to fit in your window. If it gets taller than the window, the terminal can\'t erase the part that scrolled off, and you see broken copies of the box. So the box trims itself in smaller windows: steps always come first, and the stats show only when they fit in full. When not every step fits, a line at the top counts the finished steps and a line at the bottom counts the ones still to come; `/clawd-view steps` prints the whole list.',
  '',
  '| Window size | What you get |',
  '|---|---|',
  '| 40+ lines tall | Full stats for plans up to 9 steps while working, up to 11 when done |',
  '| 35 lines tall | Full stats for plans up to 4 steps while working, up to 6 when done; no stats for longer plans |',
  '| 31 lines tall | Full stats for up to 2 steps when done; otherwise no stats |',
  '| 26 to 30 lines | A few steps at a time, stats mostly hidden (Clawd takes 5 lines) |',
  '| Under 26 lines | Clawd hides; in very short windows the box becomes one line |',
  '| Under 106 wide | No stats (they need 106 columns) |',
  '',
  'For the full stats on everyday plans, keep the window at least 35 lines tall and 106 wide (zoom out with Cmd + minus). While you type a / command the box steps down to one line, so the command list fits.',
  '',
  'In the Claude desktop app\'s Code tab there\'s no such limit: the box always shows every step and the full stats, with this session\'s figures in a column on the right when the card is wide enough.',
  '',
  '**Commands**',
  '- `/clawd-stats`: print the full stats into the conversation',
  '- `/clawd-status on` or `off`: show or hide the stats in the box',
  '- `/clawd-view on` or `off`: turn Clawd View on or off',
  '- `/clawd-view steps`: print the whole checklist into the conversation, for when a short window hides some steps',
  '- `/clawd-view panel`: open the box as a side panel (terminal fullscreen, or the desktop app)',
  '- `/clawd-view help`: show this guide',
].join('\n')
// Prints the info block into the conversation, where it scrolls with the rest and never resizes the
// live area above the prompt
const STATS_COMMAND = 'clawd-stats'
// Each /clawd-stats row's figures, by the row's text
const statsSnapshots = new Map<string, StatusSnapshot>()
const STATUS_STORE_ON = 'statusIsOn'
const STATUS_STORE_LIMITS = 'statusLimits'
// The effort each recent session last asked with, by session id: the newest this many kept
const STATUS_STORE_EFFORT = 'statusEffort'
const STATUS_EFFORT_SESSIONS = 20
// How long the first frame waits for the session's figures, and how often the clock-based ones refresh
const STATUS_START_WAIT_MS = 3000
const STATUS_TICK_MS = 5_000
// Every this many ticks the transcript and the other sessions' saved limits are checked again
const STATUS_SLOW_TICKS = 3
// /usage's cache sits in a big file, so it is read again at most once a minute
const STATUS_USAGE_CACHE_MS = 60_000
// A finished turn's figures are read back from the transcript once its last rows are written
const STATUS_RESCAN_DELAY_MS = 1500
// The faded orange of an empty bar (the same as the box's waiting bars); ORANGE and BAR are the box's own
const STATUS_EMPTY = '#54291c'
// Past this much of a limit, its bar and number turn deep orange
const STATUS_HIGH_AT = 80
const STATUS_DEEP = '#e35126'
const STATUS_BAR_CELLS = 5
// The 5-hour, weekly and context bars run longer, so the info block fills its line
const STATUS_LIMIT_CELLS = 20
// Width of the grey labels in the info block, so the values line up
const STATUS_LABEL_WIDTH = 14
// The right-hand column: its labels' width, and its whole width so every label starts in one place
const STATUS_RIGHT_LABEL = 12
const STATUS_RIGHT_WIDTH = 28
// Under this many cells inside the card, the bars shorten and day names shrink to three letters
const STATUS_TINY_WIDTH = 70
const STATUS_TINY_CELLS = 10
// The longest model and effort the Model line is laid out for ("Sonnet 5.5 xhigh" and the like)
const STATUS_MODEL_WORST = 24
// The longest note in place of a figure
const STATUS_WAIT_NOTE = 'updates on next reply'
// The shortest a stats bar gets in the desktop side panel, to keep the two columns side by side
const STATUS_PANEL_MIN_CELLS = 8
// The prompt cache lasts an hour after each reply (5 minutes when the transcript says so); under 5 minutes left it turns deep orange
const STATUS_CACHE_MS = 60 * 60_000
const STATUS_CACHE_WARN_MS = 5 * 60_000

/** 950 -> "950", 86_400 -> "86k", 1_120_000 -> "1.1M". */
export function shortCount(n: number): string {
  if (n < 1000) return String(n)
  if (Math.round(n / 1000) < 1000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** 84 minutes -> "1h 24m", 7 minutes -> "7m". */
export function spanLabel(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000))
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`
}

const STATUS_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "claude-opus-5-5[1m]" -> "Opus 5.5", "claude-haiku-4-5-20251001" -> "Haiku 4.5". */
export function prettyModel(id: string): string {
  const parts = id
    .replace(/\[.*\]$/, '')
    .replace(/^claude-/, '')
    .split('-')
    .filter(p => !/^\d{8}$/.test(p))
  const words = parts.filter(p => !/^\d+$/.test(p)).map(p => p.charAt(0).toUpperCase() + p.slice(1))
  const version = parts.filter(p => /^\d+$/.test(p)).join('.')

  return [...words, version].filter(Boolean).join(' ')
}

/** A moment as 12-hour local time: "1:50 PM", "9 AM"; with `day`, "Friday 9 AM" ("Fri 9 AM" when `short`). */
export function clock12(ms: number, zone: number, day = false, short = false): string {
  const d = new Date(ms + zone * 60_000)
  const h = d.getUTCHours()
  const min = d.getUTCMinutes()
  const time = `${h % 12 === 0 ? 12 : h % 12}${min === 0 ? '' : `:${String(min).padStart(2, '0')}`} ${h < 12 ? 'AM' : 'PM'}`

  const name = STATUS_DAYS[d.getUTCDay()]!
  return day ? `${short ? name.slice(0, 3) : name} ${time}` : time
}

const sameLocalDay = (a: number, b: number, zone: number) =>
  new Date(a + zone * 60_000).toISOString().slice(0, 10) === new Date(b + zone * 60_000).toISOString().slice(0, 10)

/** When a window resets: the time today, or the day and time later in the week. */
export function resetLabel(resetsAt: string | undefined, at: number, zone: number, short = false): string | undefined {
  if (!resetsAt) return undefined
  const ms = Date.parse(resetsAt)
  if (!Number.isFinite(ms) || ms <= at) return undefined

  return clock12(ms, zone, !sameLocalDay(ms, at, zone), short)
}

const toUsage = (u: SessionMeasureInput | SessionUsage): Usage => ({
  contextPercent: u.context.percent === undefined ? undefined : Math.round(u.context.percent),
  contextWindow: u.context.window,
  limits: u.rateLimits.map((l): Limit => ({ kind: l.kind, percentUsed: Math.round(l.percentUsed), resetsAt: l.resetsAt })),
  costUsd: u.cost?.usd,
})

/** Whichever reading of each limit is newest. A window that has passed since is unknown (its new window
 *  already holds whatever was used since), so it reads as waiting for the next reply, never a made-up 0%. */
export function pickLimits(readings: StatusReading[], at: number): StatusLimitView[] {
  const newest = (kind: string) =>
    readings
      .map(r => ({ at: r.at, limit: r.limits.find(l => l.kind === kind) }))
      .filter((r): r is { at: number; limit: Limit } => r.limit !== undefined)
      .sort((a, b) => b.at - a.at)[0]
  const out: StatusLimitView[] = []
  for (const kind of ['five_hour', 'seven_day']) {
    const best = newest(kind)
    if (!best) continue
    const ends = best.limit.resetsAt ? Date.parse(best.limit.resetsAt) : NaN
    out.push(Number.isFinite(ends) && ends <= at
      ? { kind, percentUsed: undefined, resetsAt: undefined, isFresh: true }
      : { ...best.limit, isFresh: false })
  }
  return out
}

async function readZone($: Engine): Promise<void> {
  try {
    // By its full path: a command found through PATH may be a stub that asks to install developer tools
    const run = await $.process.run(['/bin/date', '+%z'], { timeoutMs: 3000 })
    const m = run.stdout.trim().match(/^([+-])(\d\d)(\d\d)$/)
    if (m) await update($, statusZone, () => (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])))
  } catch {
    // Without the zone the times show in UTC
  }
}

/** The session's own figures: its first launch, cost so far, context and model, ready before the first frame. */
async function refresh($: Engine): Promise<void> {
  const [u, name] = await Promise.all([$.session.usage(), $.session.model()])
  await update($, statusStartedAt, () => u.startedAt)
  await update($, statusUsage, prev => {
    const fresh = toUsage(u)
    return {
      ...fresh,
      contextPercent: fresh.contextPercent ?? prev?.contextPercent,
      contextTokens: prev?.contextTokens,
      costUsd: fresh.costUsd ?? prev?.costUsd,
      limits: fresh.limits.length > 0 ? fresh.limits : (prev?.limits ?? []),
    }
  })
  // The engine's reading comes from its last reply, which may be old: a fallback only, never saved
  const engineLimits = toUsage(u).limits
  if (engineLimits.length > 0) {
    await update($, statusReadings, rs => [...rs.filter(r => r.source !== 'engine'), { source: 'engine' as const, at: 0, limits: engineLimits }])
  }
  if (name) await update($, statusModel, () => name)
}

/** Keeps the newest live limit reading, so the next start (or a resume) shows it straight away. */
async function saveLimits($: Engine, limits: Limit[]): Promise<void> {
  const at = await $.clock.now()
  await update($, statusReadings, rs => [...rs.filter(r => r.source !== 'live'), { source: 'live' as const, at, limits }])
  await $.store.set(STATUS_STORE_LIMITS, { at, limits })
}

// Reads this session's saved history (its transcript, and its agents') once at start, so Input,
// Output, Messages, cost and the cache clock count from the session's beginning, after a resume too.
// Each reply's usage repeats on every block of it, so replies count once by their id: timed by their first
// row (when the cache was touched), counted by their largest figures (later rows carry the final output).
// Read in place with $.fs (never a script through PATH, which on a Mac without the developer tools
// opens their install dialog), and only the rows written since the last pass

// $.fs.read takes files up to this size; a bigger one is read from where the last pass stopped, in
// pieces of this size, by the system's own tail
const STATUS_READ_MAX = 4 * 1024 * 1024
// How long one pass may read before it stops and carries on in the next
const STATUS_SCAN_MS = 20_000
// The agents' transcripts looked at, and how deep below the session's folder
const STATUS_AGENT_FILES = 500
const STATUS_AGENT_DEPTH = 4

type Reply = { main: boolean; at: number | null; in: number; out: number; cached: number; cc: Record<string, unknown>; xin: number; xout: number }
type ScanFile = { offset: number; isSkipping: boolean }
// One session's transcripts as read so far: each file's next unread byte, and what its rows added up to
type HistoryScan = {
  sid: string; main?: string; files: Map<string, ScanFile>
  replies: Map<unknown, Reply>; msgs: number; first: number | null; cost: number | null; sent: number | null; compacted: number
}
let historyScan: HistoryScan | undefined
// One pass at a time, as they share what was read
let historyQueue: Promise<void> = Promise.resolve()

type Json = Record<string, any>
const asObject = (v: unknown): Json | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const isoMs = (ts: unknown): number | null => {
  if (typeof ts !== 'string') return null
  const t = Date.parse(ts)
  return Number.isFinite(t) ? t : null
}

// One character at `i`: the UTF-8 bytes it takes, and the UTF-16 units it spans
function utf8Step(text: string, i: number): [number, number] {
  const c = text.charCodeAt(i)
  if (c < 0x80) return [1, 1]
  if (c < 0x800) return [2, 1]
  if ((c & 0xfc00) === 0xd800 && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) return [4, 2]
  return [3, 1]
}

/** Bytes the text takes in UTF-8. */
export function utf8Length(text: string): number {
  let n = 0
  for (let i = 0; i < text.length;) {
    const [bytes, units] = utf8Step(text, i)
    n += bytes
    i += units
  }
  return n
}

/** The text from its `bytes`th UTF-8 byte on. */
function fromByte(text: string, bytes: number): string {
  let n = 0
  let i = 0
  while (i < text.length && n < bytes) {
    const [b, units] = utf8Step(text, i)
    n += b
    i += units
  }
  return text.slice(i)
}

// Typed by the person: not a command, nor text the engine or a hook put there
const isTyped = (text: string): boolean => {
  const t = text.trim()
  return t !== '' && !NOT_TYPED_PREFIXES.some(p => t.startsWith(p)) && !t.startsWith('/') && !t.startsWith('<command-')
}
const textOf = (c: unknown): string =>
  typeof c === 'string' ? c
    : Array.isArray(c) ? c.map(asObject).filter(b => b?.type === 'text').map(b => (typeof b!.text === 'string' ? b!.text : '')).join(' ')
    : ''
const isHuman = (origin: unknown) => asObject(origin)?.kind === 'human' || asObject(origin) === undefined

/** Adds one transcript row to the session's figures. */
export const newHistoryScan = (sid: string): HistoryScan =>
  ({ sid, files: new Map(), replies: new Map(), msgs: 0, first: null, cost: null, sent: null, compacted: 0 })

export function addRow(s: HistoryScan, d: Json, isMain: boolean): void {
  const kind = d.type
  const m = asObject(d.message) ?? {}
  // The session began at its earliest row; rows are not written in time order
  if (isMain && d.timestamp) {
    const t = isoMs(d.timestamp)
    if (t !== null && (s.first === null || t < s.first)) s.first = t
  }
  // A compaction sends the whole conversation to be summarized; its reply is never written
  const pre = asObject(d.compactMetadata)?.preTokens
  if (isMain && d.subtype === 'compact_boundary' && typeof pre === 'number') s.compacted += pre
  if (kind === 'cost-state' && isMain && typeof d.totalCostUSD === 'number') s.cost = d.totalCostUSD
  if (kind === 'assistant') {
    const u = asObject(m.usage)
    const mid = m.id
    if (!u || Object.keys(u).length === 0 || !mid || m.model === '<synthetic>') return
    const cached = num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens)
    const whole = num(u.input_tokens) + cached
    let r = s.replies.get(mid)
    if (r === undefined) {
      // A main reply touched the cache when its request went out: the row before it
      let at = isoMs(d.timestamp)
      if (isMain && s.sent !== null) at = at !== null ? Math.min(at, s.sent) : s.sent
      r = { main: isMain, at, in: 0, out: 0, cached: 0, cc: {}, xin: 0, xout: 0 }
      s.replies.set(mid, r)
    }
    r.in = Math.max(r.in, whole)
    r.out = Math.max(r.out, num(u.output_tokens))
    r.cached = Math.max(r.cached, cached)
    // Calls made inside a reply (the advisor) are listed apart and left out of its own figures
    const extra = (Array.isArray(u.iterations) ? u.iterations : []).map(asObject).filter((i): i is Json => i !== undefined && i.type != null && i.type !== 'message')
    r.xin = Math.max(r.xin, extra.reduce((n, i) => n + num(i.input_tokens) + num(i.cache_read_input_tokens) + num(i.cache_creation_input_tokens), 0))
    r.xout = Math.max(r.xout, extra.reduce((n, i) => n + num(i.output_tokens), 0))
    const cc = asObject(u.cache_creation)
    if (cc && Object.keys(cc).length > 0) r.cc = cc
  } else if (kind === 'user' && isMain) {
    if (d.timestamp) s.sent = isoMs(d.timestamp)
    if (d.isMeta || d.isCompactSummary || !isHuman(d.origin)) return
    const c = m.content
    if (Array.isArray(c) && c.some(b => asObject(b)?.type === 'tool_result')) return
    if (isTyped(textOf(c))) s.msgs++
  } else if (kind === 'attachment' && isMain) {
    // A prompt typed while Claude worked joins the running turn and leaves only this row
    const a = asObject(d.attachment) ?? {}
    if (a.type === 'queued_command' && asObject(a.origin)?.kind === 'human' && isTyped(textOf(a.prompt))) s.msgs++
  }
}

/** The figures the rows read so far add up to. */
export function historyOf(s: HistoryScan, path: string, size: number): History {
  const all = [...s.replies.values()]
  const mains = all.filter(r => r.main && r.at !== null && r.in + r.out > 0).sort((a, b) => a.at! - b.at!)
  const last = mains[mains.length - 1]
  const cachedReplies = mains.filter(r => r.cached > 0)
  let cacheMinutes: number | null = null
  for (const r of [...cachedReplies].reverse()) {
    const hour = r.cc.ephemeral_1h_input_tokens
    if (num(r.cc.ephemeral_5m_input_tokens) > 0 && !hour) { cacheMinutes = 5; break }
    if (num(hour) > 0) { cacheMinutes = 60; break }
  }
  return {
    input: all.reduce((n, r) => n + r.in + r.xin, 0) + s.compacted,
    output: all.reduce((n, r) => n + r.out + r.xout, 0),
    messages: s.msgs,
    lastReply: cachedReplies.length > 0 ? cachedReplies[cachedReplies.length - 1]!.at : null,
    cacheMinutes,
    firstAt: s.first,
    cost: s.cost,
    contextTokens: last ? last.in + last.out : null,
    path,
    size,
  }
}

/** Claude Code's configuration folder: CLAUDE_CONFIG_DIR, or .claude in the home folder. */
async function configDir($: Engine): Promise<string> {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)
  if (dir) return dir.replace(/[\\/]+$/, '')
  return `${await homeDir($)}/.claude`
}

async function homeDir($: Engine): Promise<string> {
  const home = (await $.env.get('HOME').catch(() => undefined)) || (await $.env.get('USERPROFILE').catch(() => undefined))
  if (!home) throw new Error('No home folder')
  return home.replace(/[\\/]+$/, '')
}

/** The session's transcript: projects/<project>/<id>.jsonl, the session's own project tried first. */
async function findTranscript($: Engine, id: string): Promise<string | undefined> {
  const projects = `${await configDir($)}/projects`
  const root = await $.session.root().catch(() => undefined)
  if (root !== undefined) {
    const own = `${projects}/${root.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`
    if (await $.fs.exists(own).catch(() => false)) return own
  }
  const dirs = (await $.fs.list(projects)).filter(e => (e.kind === 'dir' || e.isLink) && !e.name.startsWith('.'))
  const found = await Promise.all(dirs.map(e => $.fs.exists(`${projects}/${e.name}/${id}.jsonl`).catch(() => false)))
  const i = found.indexOf(true)
  return i < 0 ? undefined : `${projects}/${dirs[i]!.name}/${id}.jsonl`
}

/** The agents' transcripts, workflow agents' further down; a workflow's journal carries no replies. */
async function agentTranscripts($: Engine, dir: string, depth = 0, out: { path: string; size: number }[] = []) {
  if (depth > STATUS_AGENT_DEPTH) return out
  const entries = await $.fs.list(dir).catch(() => [])
  for (const e of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (out.length >= STATUS_AGENT_FILES) break
    if (e.name.startsWith('.')) continue
    if (e.kind === 'dir') await agentTranscripts($, `${dir}/${e.name}`, depth + 1, out)
    else if (e.kind === 'file' && e.name.endsWith('.jsonl') && e.name !== 'journal.jsonl') out.push({ path: `${dir}/${e.name}`, size: e.size })
  }
  return out
}

/** Reads a file's complete rows written since the last pass into the figures; false when the time ran out. */
async function readNewRows($: Engine, s: HistoryScan, path: string, size: number, isMain: boolean, deadline: number): Promise<boolean> {
  let f = s.files.get(path)
  if (f === undefined) s.files.set(path, (f = { offset: 0, isSkipping: false }))
  while (f.offset < size) {
    if (Date.now() > deadline) return false
    let text: string
    let isCut = false
    if (size <= STATUS_READ_MAX) {
      text = fromByte((await $.fs.read(path)) as string, f.offset)
    } else {
      // By its full path (never PATH's); its output comes at most 4 MiB at a time
      const run = await $.process.run(['/usr/bin/tail', '-c', `+${f.offset + 1}`, path], { timeoutMs: 10_000 })
      if (run.exitCode !== 0) throw new Error(run.stderr)
      text = run.stdout
      isCut = run.isStdoutTruncated === true
    }
    const end = text.lastIndexOf('\n')
    if (end < 0) {
      if (!isCut) return true
      // A row longer than one piece is passed over to its end
      f.offset += utf8Length(text)
      f.isSkipping = true
      continue
    }
    const lines = text.slice(0, end).split('\n')
    if (f.isSkipping) {
      lines.shift()
      f.isSkipping = false
    }
    for (const line of lines) {
      let d: unknown
      try {
        d = JSON.parse(line)
      } catch {
        continue
      }
      const row = asObject(d)
      if (row) addRow(s, row, isMain)
    }
    f.offset += utf8Length(text.slice(0, end + 1))
    // An unfinished last row is read once it is written whole
    if (!isCut) return true
  }
  return true
}

/** The session's figures from its transcripts, reading only what is new; 'later' when a pass ran out of time. */
async function scanHistory($: Engine, id: string): Promise<History | 'later' | undefined> {
  if (historyScan?.sid !== id) historyScan = newHistoryScan(id)
  const s = historyScan
  s.main ??= await findTranscript($, id)
  if (s.main === undefined) return undefined
  const main = s.main
  const { size } = await $.fs.stat(main)
  const agents = await agentTranscripts($, `${main.slice(0, -'.jsonl'.length)}/subagents`)
  // A file shorter than what was read of it was written anew: everything is read again
  if ([{ path: main, size }, ...agents].some(a => a.size < (s.files.get(a.path)?.offset ?? 0))) {
    historyScan = undefined
    return 'later'
  }
  const deadline = Date.now() + STATUS_SCAN_MS
  if (!(await readNewRows($, s, main, size, true, deadline))) return 'later'
  for (const a of agents) {
    if (a.size === s.files.get(a.path)?.offset) continue
    try {
      if (!(await readNewRows($, s, a.path, a.size, false, deadline))) return 'later'
    } catch {
      // An agent's transcript that cannot be read leaves its figures out
    }
  }
  return historyOf(s, main, size)
}

type History = {
  input?: number; output?: number; messages?: number; lastReply?: number | null
  cacheMinutes?: number | null; firstAt?: number | null; cost?: number | null; contextTokens?: number | null
  path?: string; size?: number
}

function readHistory($: Engine): Promise<void> {
  const pass = historyQueue.then(() => readHistoryNow($))
  historyQueue = pass.catch(() => {})
  return pass
}

async function readHistoryNow($: Engine): Promise<void> {
  const seq = ++scanSeq
  // What was counted live before the scan began is in the transcript it reads
  const snap = { ...liveCounts }
  try {
    const id = await $.session.id()
    const h = await scanHistory($, id)
    // A long transcript is read on over several passes
    if (h === 'later') {
      queueRescan($)
      return
    }
    if (h === undefined || typeof h.input !== 'number' || typeof h.output !== 'number') return
    // A newer scan, or another session's figures, replaced this one while it ran
    if (seq !== scanSeq || id !== loadedSession) return
    scanBase = { input: h.input, output: h.output, messages: typeof h.messages === 'number' ? h.messages : 0 }
    liveAtScan = snap
    if (typeof h.path === 'string') transcriptPath = h.path
    if (typeof h.size === 'number') transcriptSize = h.size
    await showCounts($)
    if (typeof h.lastReply === 'number') await update($, statusCacheAt, at => Math.max(at ?? 0, h.lastReply!))
    if (h.cacheMinutes === 5 || h.cacheMinutes === 60) {
      const ttl = h.cacheMinutes * 60_000
      await update($, statusCacheTtl, () => ttl)
    }
    if (typeof h.firstAt === 'number') await update($, statusStartedAt, s => s ?? h.firstAt!)
    await update($, statusUsage, u => {
      const base: Usage = u ?? { limits: [] }
      return {
        ...base,
        contextTokens: typeof h.contextTokens === 'number' ? h.contextTokens : base.contextTokens,
        historyCost: typeof h.cost === 'number' ? h.cost : base.historyCost,
      }
    })
  } catch {
    // Without the history the counts start from now
  }
}

// The limits /usage last fetched, from Claude Code's own cache (a figure 0-100 per window); never the
// account token, never a network call. Read again only when the file has changed
let usageCacheFile: { path: string; size: number; mtimeMs: number; reading: StatusReading | undefined } | undefined

/** Rounds a half to the even number (2.5 -> 2, 3.5 -> 4), as the figures always have been. */
const roundHalfEven = (x: number) => {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

async function readUsageCache($: Engine): Promise<StatusReading | undefined> {
  // Claude Code keeps it in .claude.json: in CLAUDE_CONFIG_DIR when that is set, else in the home folder
  const dir = await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)
  const path = `${dir ? dir.replace(/[\\/]+$/, '') : await homeDir($)}/.claude.json`
  const { size, mtimeMs } = await $.fs.stat(path)
  const known = usageCacheFile
  if (known && known.path === path && known.size === size && known.mtimeMs === mtimeMs) return known.reading
  const c = asObject(asObject(JSON.parse((await $.fs.read(path)) as string))?.cachedUsageUtilization) ?? {}
  const u = asObject(c.utilization) ?? {}
  const limits: Limit[] = []
  for (const kind of ['five_hour', 'seven_day']) {
    const w = asObject(u[kind])
    if (w && typeof w.utilization === 'number') {
      limits.push({ kind, percentUsed: roundHalfEven(w.utilization), resetsAt: typeof w.resets_at === 'string' ? w.resets_at : undefined })
    }
  }
  const reading: StatusReading | undefined = typeof c.fetchedAtMs === 'number' && limits.length > 0 ? { source: 'usage', at: c.fetchedAtMs, limits } : undefined
  usageCacheFile = { path, size, mtimeMs, reading }
  return reading
}

/** The last limit readings this account saw: the one saved here, and the one /usage cached. */
async function readSavedLimits($: Engine): Promise<void> {
  await readStoredLimits($)
  usageCacheReadAt = await $.clock.now()
  try {
    const found = await readUsageCache($)
    if (found) await update($, statusReadings, rs => [...rs.filter(r => r.source !== 'usage'), found])
  } catch {
    // No /usage cache
  }
}

/** The reading every session on this account saves: another window's newer one shows here too. */
async function readStoredLimits($: Engine): Promise<void> {
  try {
    const saved = (await $.store.get(STATUS_STORE_LIMITS)) as { at?: unknown; limits?: unknown } | undefined
    if (!saved || typeof saved.at !== 'number' || !Array.isArray(saved.limits)) return
    const reading: StatusReading = { source: 'saved', at: saved.at, limits: saved.limits as Limit[] }
    await update($, statusReadings, rs => {
      const old = rs.find(r => r.source === 'saved')
      return old && old.at === reading.at ? rs : [...rs.filter(r => r.source !== 'saved'), reading]
    })
  } catch {
    // Nothing saved yet
  }
}

/** The effort the session runs at before its first request names it: the last one seen, else an
 *  environment override, else settings. */
async function readEffort($: Engine): Promise<void> {
  try {
    const id = await $.session.id()
    await sweepOldEfforts($)
    const saved = asObject(await $.store.get(STATUS_STORE_EFFORT).catch(() => undefined))?.[id]
    envEffort = await readEnvEffort($)
    const fromSettings = (await $.settings.read().catch(() => ({}) as { effortLevel?: unknown })).effortLevel
    if (typeof fromSettings === 'string' || typeof fromSettings === 'number') settingsEffort = String(fromSettings)
    const level = typeof saved === 'string' ? saved : (envEffort ?? (typeof fromSettings === 'string' || typeof fromSettings === 'number' ? String(fromSettings) : undefined))
    if (level !== undefined) await update($, statusEffort, e => e ?? level)
  } catch {
    // The effort shows from the first request
  }
}

/** The effort an environment variable sets over the settings, when it names one. */
async function readEnvEffort($: Engine): Promise<string | undefined> {
  const pick = (v: string | undefined) => {
    const t = v?.trim().toLowerCase()
    return t !== undefined && /^(low|medium|high|xhigh|max|\d+)$/.test(t) ? t : undefined
  }
  return pick(await $.env.get('CLAUDE_CODE_EFFORT_LEVEL').catch(() => undefined)) ?? pick(await $.env.get('CLAUDE_EFFORT').catch(() => undefined))
}

/** Notes the session's effort, keeping the newest STATUS_EFFORT_SESSIONS sessions' and dropping older ones. */
async function saveEffort($: Engine, id: string, level: string): Promise<void> {
  const saved = asObject(await $.store.get(STATUS_STORE_EFFORT).catch(() => undefined)) ?? {}
  const ids = Object.keys(saved)
  if (saved[id] === level && ids[ids.length - 1] === id) return
  const kept = Object.entries(saved).filter(([k, v]) => k !== id && typeof v === 'string').slice(-(STATUS_EFFORT_SESSIONS - 1))
  await $.store.set(STATUS_STORE_EFFORT, Object.fromEntries([...kept, [id, level]]))
}

// Earlier versions kept one key per session, never removed
let isEffortSwept = false
async function sweepOldEfforts($: Engine): Promise<void> {
  if (isEffortSwept) return
  isEffortSwept = true
  const keys = await $.store.keys().catch(() => [] as string[])
  for (const key of keys) if (key.startsWith(`${STATUS_STORE_EFFORT}:`)) await $.store.delete(key).catch(() => {})
}

// The session whose figures are on screen; a /clear or an in-app resume moves to another id without a
// new session.start, so every figure is reset and read again for the new one
let loadedSession: string | undefined

async function resetStatus($: Engine): Promise<void> {
  liveCounts = { ...ZERO }
  scanBase = null
  liveAtScan = { ...ZERO }
  scanSeq++
  transcriptPath = undefined
  transcriptSize = -1
  await update($, statusTokens, () => ({ input: 0, output: 0 }))
  await update($, statusMessages, () => 0)
  await update($, statusCacheAt, () => null)
  await update($, statusCacheTtl, () => null)
  await update($, statusStartedAt, () => null)
  await update($, statusUsage, u => (u === null ? u : { limits: u.limits, contextWindow: u.contextWindow }))
}

/** Reads the session's figures, once per session id: at start, and after a /clear or resume. */
async function loadSession($: Engine, waitMs?: number): Promise<void> {
  const id = await $.session.id().catch(() => undefined)
  if (id === undefined || id === loadedSession) return
  const isSwitch = loadedSession !== undefined
  loadedSession = id
  if (isSwitch) await resetStatus($)
  const reads = Promise.all([
    refresh($).catch(() => {}),
    readEffort($),
    readSavedLimits($),
    readHistory($),
    readZone($),
  ])
  await (waitMs === undefined ? reads : within($, reads, waitMs))
}

const within = <T,>($: Engine, p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<void>(resolve => { $.clock.after(ms, () => resolve()) })])

/** The checks that need not run every tick: transcript growth, saved limits, model and effort. */
async function slowRefresh($: Engine, t: number): Promise<void> {
  await readStoredLimits($)
  if (t - usageCacheReadAt >= STATUS_USAGE_CACHE_MS) await readSavedLimits($)
  if (!isMainTurnRunning) {
    if (transcriptPath !== undefined) {
      const st = await $.fs.stat(transcriptPath).catch(() => null)
      if (st && st.size !== transcriptSize) queueRescan($)
    }
    const name = await $.session.model().catch(() => undefined)
    if (name) await update($, statusModel, m => (m === name ? m : name))
  }
  try {
    const level = (await $.settings.read()).effortLevel
    const now = typeof level === 'string' || typeof level === 'number' ? String(level) : undefined
    if (now !== undefined && settingsEffort !== undefined && now !== settingsEffort && envEffort === undefined) await update($, statusEffort, () => now)
    settingsEffort = now
  } catch {
    // The effort shows from the next request
  }
}

/** Sets the status row up as the session starts; called from Clawd View's own session.start. */
async function startStatus($: Engine): Promise<void> {
  await $.command.register({
    name: STATS_COMMAND,
    description: 'Show model, usage limits, context, cost and session figures in the conversation',
  })
  await $.command.register({
    name: STATUS_COMMAND,
    description: 'Status row on or off: model, usage limits, context and cost on top of the Clawd View box',
    argumentHint: 'on|off',
  })
  const stored = await $.store.get(STATUS_STORE_ON)
  if (typeof stored === 'boolean') await update($, statusIsOn, () => stored)
  const start = await $.clock.now()
  await update($, statusNow, () => start)
  // The local zone straight away (the process check confirms it), so no first frame shows UTC times
  await update($, statusZone, z => z ?? -new Date(start).getTimezoneOffset())
  // Everything the first frame needs, read together; a slow history scan finishes in the background
  loadedSession = undefined
  liveCounts = { ...ZERO }
  scanBase = null
  liveAtScan = { ...ZERO }
  await loadSession($, STATUS_START_WAIT_MS)
  // Keeps the session time, cache clock and reset times fresh, and notices a /clear or resume; every
  // few ticks also reads back a grown transcript, other sessions' limits, and a /model or /effort change
  $.clock.every(STATUS_TICK_MS, async () => {
    const t = await $.clock.now()
    await update($, statusNow, () => t)
    await loadSession($).catch(() => {})
    slowTick = (slowTick + 1) % STATUS_SLOW_TICKS
    if (slowTick === 0) await slowRefresh($, t).catch(() => {})
  })
}

function registerStatus(on: On): void {
  // The figures as they are at the command, kept by the row's text: a row in the conversation must
  // never redraw with newer figures, or its top, already scrolled into the terminal's history, stays
  // behind while the rest draws again under it (the block printed twice in one border)
  on('command.run', { command: STATS_COMMAND }, async $ => {
    // Printed even while the figures in the box are switched off
    const snapshot = { ...(await readStatus($)), isOn: true }
    // One text per row, so two runs in the same minute never share figures
    const at = `Claude stats at ${clock12(snapshot.t, snapshot.savedZone ?? 0, false)}`
    let text = at
    for (let n = 2; statsSnapshots.has(text); n++) text = `${at} (${n})`
    statsSnapshots.set(text, snapshot)
    return { text }
  }).catch(() => ({ text: 'The stats could not be read. Try again.' }))

  on('ui.render', { component: 'CommandOutput', props: { command: STATS_COMMAND } }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    // The row's text arrives under the plugin's name ("clawd-view: Claude stats at 9:33 AM")
    const text = e.props.text.trim()
    const snapshot = statsSnapshots.get(text)
      ?? statsSnapshots.get(text.replace(/^clawd-view:\s*/, ''))
      ?? [...statsSnapshots.entries()].filter(([k]) => text.endsWith(k)).sort((x, y) => y[0].length - x[0].length)[0]?.[1]
    // A row from before a reload has no snapshot left: its text alone, which never changes
    if (snapshot === undefined) return next(e)
    const els = $.ui.resolve(e)
    // Only the desktop has Svg; elsewhere the bars are drawn in text
    const { Box, Text } = els
    const Svg = (els as { Svg?: (props: any) => any }).Svg
    const width = Math.max(40, Math.min(120, (e.viewport?.columns ?? 100) - 8))
    const drawn = await statusRow($, { Box, Text, Svg }, width, snapshot, e.surface === 'desktop')
    const info = drawn === null ? null : (drawn.full ?? drawn.stacked)
    if (info === null) return <Text dimColor>The figures are off. Turn them on with /clawd-status on.</Text>
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={CARD_ORANGE} paddingX={1} width={width + 4}>
        <Text color={CARD_ORANGE} bold>✻ Claude stats</Text>
        {info.node}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('command.run', { command: STATUS_COMMAND }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') return { text: 'Use /clawd-status on, /clawd-status off, or /clawd-status to switch it.' }
    const value = arg === '' ? !(await read($, statusIsOn)) : arg === 'on'
    await update($, statusIsOn, () => value)
    await $.store.set(STATUS_STORE_ON, value)
    return { text: value ? 'Status row is on.' : 'Status row is off.' }
  }).catch(() => ({ text: 'The status row could not switch. Try again.' }))

  // /clear and an in-app resume end the conversation without a new session.start: the old card goes,
  // and the new session id's figures load right after
  on('session.end', async ($, e, next) => {
    const isNewConversation = e.reason === 'clear' || e.reason === 'resume'
    if (isNewConversation) await edit($, () => null).catch(() => null)
    const ended = await next(e)
    if (isNewConversation) $.clock.after(250, () => void loadSession($).catch(() => {}))
    return ended
  }).catch(($, e, next) => next(e))

  // /model shows straight away, not at the next request
  on('classic.PostModelSwitch', async ($, e, next) => {
    try {
      if (typeof e.to_model === 'string' && e.to_model !== '') await update($, statusModel, () => e.to_model)
    } catch {
      // The next request names it
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A compaction sends the conversation to be summarized: its tokens count too
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    try {
      const used = (result as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } | undefined)?.usage
      if (used) {
        await addLive($, {
          input: (used.input_tokens ?? 0) + (used.cache_read_input_tokens ?? 0) + (used.cache_creation_input_tokens ?? 0),
          output: used.output_tokens ?? 0,
        })
      }
    } catch {
      // The next scan counts it
    }
    return result
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    try {
      const reading = toUsage(e)
      await update($, statusUsage, prev => ({
        ...reading,
        contextPercent: reading.contextPercent ?? prev?.contextPercent,
        contextTokens: prev?.contextTokens,
        costUsd: reading.costUsd ?? prev?.costUsd,
        // Limits come with API replies; keep the last reading until a new one arrives
        limits: reading.limits.length > 0 ? reading.limits : (prev?.limits ?? []),
      }))
      if (reading.limits.length > 0) await saveLimits($, reading.limits)
    } catch {
      // The row keeps its last figures
    }
    return next(e)
  })

  // Notes the main thread's model and effort as each request goes out and, once each reply is in, adds
  // its tokens and restarts the cache clock from when the request went out (the cache is touched then)
  on('turn.step', async function* ($, e, next) {
    // Any loop (main or an agent's) taking its next step means a permission prompt before it was answered
    await clearPermission($).catch(() => {})
    const sentAt = await $.clock.now()
    if (!e.agentId) {
      await update($, statusModel, () => e.model)
      if (e.effort !== undefined) {
        const level = String(e.effort)
        await update($, statusEffort, () => level)
        void $.session.id().then(id => saveEffort($, id, level)).catch(() => {})
      }
    }
    const result = yield* next(e)
    const used = result.usage
    if (e.agentId) {
      // The agent line: its model, and its context at this step (what Claude Code's own agent count shows)
      const job = await read($, checklist)
      if (job !== null && isLive(job)) await noteJob($, job.startedAt)
      const seen = news.helpers.get(e.agentId)
      const model = shortModel(e.model) ?? seen?.model
      const tokens = used ? used.input_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens + used.output_tokens : seen?.tokens
      news.helpers.set(e.agentId, { description: '', status: 'running', listed: false, ...seen, model, tokens, startedAt: seen?.startedAt ?? sentAt })
    }
    if (used) {
      await addLive($, {
        input: used.input_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens,
        output: used.output_tokens,
      })
      if (!e.agentId && used.cache_read_input_tokens + used.cache_creation_input_tokens > 0) {
        await update($, statusCacheAt, () => sentAt)
      }
    }
    if (!e.agentId) {
      const at = await $.clock.now()
      await update($, statusNow, () => at)
    }
    return result
  })
}

type StatusElements = { Box: (props: any) => any; Text: (props: any) => any; Svg?: (props: any) => any }

/** The status row, or null when it is off. Read in the same draw as the box, so they never drift. */
type InfoBlock = { node: RenderChildren; rows: number }

/** The info block in its two forms: full (two columns, one fact a line; null when the card is too
 *  narrow for it) and stacked (every fact on its own line; null when full is drawn). */
/** Every figure the info block shows, read at one moment. Read while drawing, it subscribes the
 *  drawing; read from a command, it is a snapshot that never changes. */
async function readStatus($: Engine) {
  // Every value in one parallel read, so the lines land in the same frame as the box
  const [isOn, u, saved, savedZone, name, level, tokens, messages, cacheAt, cacheTtl, startedAt, readings] = await Promise.all([
    read($, statusIsOn), read($, statusUsage), read($, statusNow), read($, statusZone), read($, statusModel), read($, statusEffort),
    read($, statusTokens), read($, statusMessages), read($, statusCacheAt), read($, statusCacheTtl), read($, statusStartedAt),
    read($, statusReadings),
  ])
  // The clock now, never an older tick's time, so minutes change on time
  const t = Math.max(saved, await $.clock.now())
  const model = name ?? (await $.session.model().catch(() => 'Claude'))
  return { isOn, u, savedZone, model, level, tokens, messages, cacheAt, cacheTtl, startedAt, readings, t }
}
type StatusSnapshot = Awaited<ReturnType<typeof readStatus>>

async function statusRow($: Engine, { Box, Text, Svg }: StatusElements, width: number, snapshot?: StatusSnapshot, isWide = false, hideResets = false): Promise<{ full: InfoBlock | null; stacked: InfoBlock | null } | null> {
  // The desktop app (isWide) draws the bars as Svg. Its card is laid out in cells like the
  // terminal's, so there too the two columns sit side by side only where `width` holds them (97
  // cells with the reset times, 86 without, as in the side panel); a narrower card stacks them
  const { isOn, u, savedZone, model, level, tokens, messages, cacheAt, cacheTtl, startedAt, readings, t } = snapshot ?? (await readStatus($))
  if (!isOn) return null
  const zone = savedZone ?? 0
  // A very narrow card gets shorter bars and day names
  const isTiny = width < STATUS_TINY_WIDTH

  // The shape (two columns or one stacked column) depends on the width alone, measured against the
  // longest each line can ever be, so new figures arriving never change the box's height mid-task
  const worstNote = isTiny ? 'resets Wed 12:30 PM'.length : 'resets Wednesday 12:30 PM'.length
  const fullCells = isTiny ? STATUS_TINY_CELLS : STATUS_LIMIT_CELLS
  // With the reset times left out, the longest a limit line gets is a bar and a note waiting for
  // the first reply
  const worstLeft = hideResets
    ? Math.max(STATUS_MODEL_WORST, fullCells + 1 + STATUS_WAIT_NOTE.length)
    : Math.max(STATUS_MODEL_WORST, fullCells + 5 + 3 + worstNote)
  // The desktop app's side panel (no reset times) keeps the session's facts on the right as the
  // person asked, giving up bar length for it: down to STATUS_PANEL_MIN_CELLS cells a bar
  const panelLeft = Math.max(STATUS_MODEL_WORST, STATUS_PANEL_MIN_CELLS + 1 + STATUS_WAIT_NOTE.length)
  const isSideBySide =
    STATUS_LABEL_WIDTH + worstLeft + 2 + STATUS_RIGHT_WIDTH <= width ||
    (isWide && hideResets && STATUS_LABEL_WIDTH + panelLeft + 2 + STATUS_RIGHT_WIDTH <= width)
  // What a value may take after its label, so no line is ever wider than the card
  const valueRoom = Math.max(4, (isSideBySide ? width - 2 - STATUS_RIGHT_WIDTH : width) - STATUS_LABEL_WIDTH)
  const clip = (text: string, room: number) => (text.length <= room ? text : room <= 1 ? '' : `${text.slice(0, room - 1)}…`)
  const cells = Math.max(3, Math.min(fullCells, valueRoom - 5))

  // Each column in a fixed-width box, so the desktop app's proportional font lines it up too
  const column = (k: string, width: number, children: unknown) => (
    <Box key={k} width={width} flexShrink={0} overflow="hidden" flexDirection="row" alignItems="center">
      {children as never}
    </Box>
  )
  const bar = (pct: number, color: string) => {
    const lit = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)))
    if (isWide && Svg) {
      const colors = Array.from({ length: cells }, (_, i) => (i < lit ? color : STATUS_EMPTY))
      return column('bar', cells, <Svg source={barSvg(colors)} alt={`${pct}%`} width={svgPx(cells * DESKTOP_CELL_PX)} height={svgPx(DESKTOP_BAR_PX)} />)
    }
    return column('bar', cells, [
      <Text key="on" color={color}>{BAR.repeat(lit)}</Text>,
      <Text key="off" color={STATUS_EMPTY}>{BAR.repeat(cells - lit)}</Text>,
    ])
  }
  // A limit past 80% turns deep orange; context keeps its usual orange. With no reading the bar stays
  // empty and says when it fills, never a placeholder. The note is cut to the room left, or left out
  const meter = (k: string, pct: number | undefined, note?: string, warns = false) => {
    const color = warns && pct !== undefined && pct > STATUS_HIGH_AT ? STATUS_DEEP : ORANGE
    const gap = pct === undefined ? ' ' : '   '
    const noteRoom = valueRoom - cells - (pct === undefined ? 0 : 5) - gap.length
    // A reset time stays out of the side panel; a note standing in for a missing figure stays
    const shown = note && !(hideResets && pct !== undefined) && noteRoom >= 6 ? clip(note, noteRoom) : ''
    return (
      <Box key={k} flexDirection="row" flexShrink={0}>
        {bar(pct ?? 0, color)}
        {pct === undefined ? null : column('p', 5, <Text color={color} bold wrap="truncate-end">{` ${pct}%`.padEnd(5)}</Text>)}
        {shown ? <Text dimColor wrap="truncate-end">{`${gap}${shown}`}</Text> : null}
      </Box>
    )
  }

  // The newest reading of each limit: this run's live one, the one saved last time, or /usage's cache
  const views = pickLimits(readings, t)
  const limitParts = (kind: string): [number | undefined, string] => {
    const v = views.find(l => l.kind === kind)
    if (!v) return [undefined, 'after first reply']
    if (v.isFresh || v.percentUsed === undefined) return [undefined, 'updates on next reply']
    const reset = resetLabel(v.resetsAt, t, zone, isTiny)
    return [v.percentUsed, reset ? `resets ${reset}` : 'updates on next reply']
  }
  const fiveParts = limitParts('five_hour')
  const weekParts = limitParts('seven_day')

  // An info block: one fact per line, grey labels lined up on the left, a blank line above it
  const line = (k: string, label: string, value: unknown) => (
    <Box key={k} flexDirection="row" flexShrink={0}>
      {column('l', STATUS_LABEL_WIDTH, <Text dimColor wrap="truncate-end">{label.padEnd(STATUS_LABEL_WIDTH)}</Text>)}
      {value as never}
    </Box>
  )
  const modelName = prettyModel(model)
  const modelText = clip(`${modelName}${level ? ` ${level}` : ''}`, valueRoom)
  // The engine's running total; right after a resume it can read 0 before it restores, so the
  // transcript's total stands in
  const liveCost = u?.costUsd ?? 0
  const costText = `$${(liveCost > 0 ? liveCost : Math.max(liveCost, u?.historyCost ?? 0)).toFixed(2)}`
  // With no reply yet there is no figure: the system prompt already fills part of the window
  const contextPct = u?.contextPercent
    ?? (u?.contextTokens !== undefined && u.contextWindow ? Math.min(100, Math.round((u.contextTokens / u.contextWindow) * 100)) : undefined)
  const left: unknown[] = [
    line('model', 'Model', [
      <Text key="m" color={ORANGE} wrap="truncate-end">{modelText.slice(0, modelName.length)}</Text>,
      ...(modelText.length > modelName.length ? [<Text key="e" dimColor wrap="truncate-end">{modelText.slice(modelName.length)}</Text>] : []),
    ]),
    line('5h', '5-hour limit', meter('5hm', fiveParts[0], fiveParts[1], true)),
    line('7d', 'Weekly limit', meter('7dm', weekParts[0], weekParts[1], true)),
    line('ctx', 'Context', meter('ctxm', contextPct, contextPct === undefined ? 'after first reply' : undefined)),
    line('cost', 'Cost', <Text color={ORANGE} wrap="truncate-end">{clip(costText, valueRoom)}</Text>),
  ]

  // The right-hand column: this session, one fact per line. Beside the left facts when the card is
  // wide enough; otherwise under them, in the same label grid
  const fact = (k: string, label: string, value: string, color = ORANGE) =>
    isSideBySide ? (
      <Box key={k} flexDirection="row" width={STATUS_RIGHT_WIDTH} flexShrink={0} marginLeft={2}>
        {column('l', STATUS_RIGHT_LABEL, <Text dimColor wrap="truncate-end">{label.padEnd(STATUS_RIGHT_LABEL)}</Text>)}
        <Text color={color} wrap="truncate-end">{clip(value, STATUS_RIGHT_WIDTH - STATUS_RIGHT_LABEL)}</Text>
      </Box>
    ) : (
      line(k, label, <Text color={color} wrap="truncate-end">{clip(value, valueRoom)}</Text>)
    )
  const ttl = cacheTtl ?? STATUS_CACHE_MS
  const cacheLeft = cacheAt === null ? null : cacheAt + ttl - t
  // Deep orange in the last few minutes: 5 of an hour's cache, 1 of a 5-minute one
  const warnAt = ttl <= 5 * 60_000 ? 60_000 : STATUS_CACHE_WARN_MS
  const right = [
    fact('session', 'Session', spanLabel(t - (startedAt ?? t))),
    cacheLeft === null
      ? fact('cache', 'Cache', 'starts on reply')
      : cacheLeft <= 0
        ? fact('cache', 'Cache', 'expired', STATUS_DEEP)
        : fact('cache', 'Cache', `${cacheLeft < 60_000 ? 'under 1m' : spanLabel(cacheLeft)} left`, cacheLeft < warnAt ? STATUS_DEEP : ORANGE),
    fact('in', 'Input', `${shortCount(tokens.input)} tokens`),
    fact('out', 'Output', `${shortCount(tokens.output)} tokens`),
    fact('msgs', 'Messages', `${messages} sent`),
  ]

  // Too narrow for two columns: every fact on its own line. The main screen box shows no figures
  // then; the side panel and the desktop card have the height for them
  if (!isSideBySide) {
    const stacked: InfoBlock = {
      node: (
        <Box key="status-row" flexDirection="column" marginTop={1}>
          {left as never}
          {right as never}
        </Box>
      ),
      rows: 1 + left.length + right.length,
    }
    return { full: null, stacked }
  }

  return {
    full: {
      node: (
        <Box key="status-row" flexDirection="column" marginTop={1}>
          {left.map((l, i) => (
            <Box key={`row${i}`} flexDirection="row" justifyContent="space-between">
              <Box flexShrink={1}>{l as never}</Box>
              {right[i]}
            </Box>
          ))}
        </Box>
      ),
      rows: 1 + left.length,
    },
    stacked: null,
  }
}
