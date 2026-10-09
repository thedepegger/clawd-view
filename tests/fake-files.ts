// Synthetic Claude Code files for the stats tests: $.env, $.fs and /usr/bin/tail answered from memory.
// Every fixture is made up; nothing is read from a real configuration folder
import { mock } from './kit'

export const HOME = '/home/tester'
export const CONFIG = `${HOME}/.claude`
export const READ_MAX = 4 * 1024 * 1024

export type FakeFiles = {
  files: Map<string, string>
  // Each $.fs.read and each tail, by path, in order
  reads: string[]
  tails: string[]
  // Every command run, as its argument vector
  runs: string[][]
  // Files whose stat says they are over $.fs.read's 4 MiB, so they are read through tail
  big: Set<string>
}

/** Answers HOME (and `env`), $.fs over `files`, /bin/date with `zone`, and /usr/bin/tail in pieces of `tailChunk`. */
export function fakeFiles(on: any, files: Record<string, string>, opts: { env?: Record<string, string>; zone?: string; tailChunk?: number; gate?: () => Promise<void> } = {}): FakeFiles {
  const fake: FakeFiles = { files: new Map(Object.entries(files)), reads: [], tails: [], runs: [], big: new Set() }
  mock.env(on, { HOME, ...opts.env })
  const isDir = (p: string) => [...fake.files.keys()].some(f => f.startsWith(`${p}/`))
  // Sizes in characters: fixtures stay ASCII, so they match the plugin's byte offsets
  const sizeOf = (p: string) => (fake.big.has(p) ? READ_MAX + 1 : fake.files.get(p)!.length)
  on('fs.read', async (_: unknown, e: any, next: any) => {
    if (!fake.files.has(e.path) || fake.big.has(e.path)) return next(e)
    await opts.gate?.()
    fake.reads.push(e.path)
    return { value: fake.files.get(e.path) }
  })
  on('fs.stat', (_: unknown, e: any, next: any) => {
    if (fake.files.has(e.path)) return { value: { kind: 'file', size: sizeOf(e.path), mtimeMs: 1, isLink: false } }
    if (isDir(e.path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    return next(e)
  })
  on('fs.exists', (_: unknown, e: any) => ({ value: fake.files.has(e.path) || isDir(e.path) }))
  on('fs.list', (_: unknown, e: any, next: any) => {
    if (!isDir(e.path)) return next(e)
    const names = new Map<string, 'file' | 'dir'>()
    for (const f of fake.files.keys()) {
      if (!f.startsWith(`${e.path}/`)) continue
      const rest = f.slice(e.path.length + 1)
      names.set(rest.split('/')[0]!, rest.includes('/') ? 'dir' : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: kind === 'file' ? sizeOf(`${e.path}/${name}`) : 0, mtimeMs: 1, isLink: false })) }
  })
  on('process.run', (_: unknown, e: any) => {
    const argv: string[] = e.argv
    fake.runs.push(argv)
    if (argv[0] === '/bin/date') return { value: { exitCode: 0, stdout: `${opts.zone ?? '+0000'}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === '/usr/bin/tail' && fake.files.has(argv[3]!)) {
      // ASCII fixtures: a byte is a character
      fake.tails.push(argv[3]!)
      const rest = fake.files.get(argv[3]!)!.slice(Number(argv[2]!.slice(1)) - 1)
      const chunk = opts.tailChunk ?? READ_MAX
      return { value: { exitCode: 0, stdout: rest.slice(0, chunk), stderr: '', isStdoutTruncated: rest.length > chunk, isStderrTruncated: false } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: 'not found', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return fake
}

export const transcriptPath = (sid: string, project = '-tmp') => `${CONFIG}/projects/${project}/${sid}.jsonl`
export const agentPath = (sid: string, name: string, project = '-tmp') => `${CONFIG}/projects/${project}/${sid}/subagents/${name}.jsonl`
export const jsonl = (rows: object[]) => rows.map(r => `${JSON.stringify(r)}\n`).join('')

const iso = (ms: number) => new Date(ms).toISOString()
export const typedRow = (text: string, at: number) => ({ type: 'user', timestamp: iso(at), message: { role: 'user', content: text } })
export const replyRow = (id: string, at: number, usage: object) => ({ type: 'assistant', timestamp: iso(at), message: { id, model: 'claude-opus-5-5', role: 'assistant', usage } })

/** A transcript (and an agent's, for what the last reply leaves over) whose rows add up to these figures. */
export function historyFiles(sid: string, h: { input: number; output: number; messages?: number; lastReply?: number | null; cacheMinutes?: 5 | 60 | null; firstAt?: number; cost?: number; contextTokens?: number }): Record<string, string> {
  const t0 = h.firstAt ?? h.lastReply ?? Date.parse('2026-10-01T00:00:00Z')
  const ctx = h.contextTokens ?? h.input + h.output
  const out = Math.min(h.output, ctx)
  const inp = ctx - out
  if (inp > h.input) throw new Error('the last reply cannot take more than the whole input')
  const main: object[] = []
  const messages = h.messages ?? 0
  main.push(messages > 0 ? typedRow('Hello there', t0) : { type: 'user', isMeta: true, timestamp: iso(t0), message: { role: 'user', content: 'note' } })
  for (let i = 1; i < messages; i++) main.push(typedRow(`Prompt ${i}`, t0))
  if (ctx > 0) {
    const at = typeof h.lastReply === 'number' ? h.lastReply : t0
    main.push({ type: 'user', timestamp: iso(at), message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } })
    const cc = h.cacheMinutes === 60 ? { ephemeral_1h_input_tokens: 1 } : h.cacheMinutes === 5 ? { ephemeral_5m_input_tokens: 1 } : undefined
    main.push(replyRow('msg_main', at, typeof h.lastReply === 'number'
      ? { input_tokens: 0, cache_read_input_tokens: inp, cache_creation_input_tokens: 0, output_tokens: out, ...(cc ? { cache_creation: cc } : {}) }
      : { input_tokens: inp, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: out }))
  }
  if (h.cost !== undefined) main.push({ type: 'cost-state', totalCostUSD: h.cost })
  const files: Record<string, string> = { [transcriptPath(sid)]: jsonl(main) }
  if (h.input - inp > 0 || h.output - out > 0) {
    files[agentPath(sid, 'agent-a1')] = jsonl([replyRow('msg_agent', t0, { input_tokens: h.input - inp, output_tokens: h.output - out })])
  }
  return files
}
