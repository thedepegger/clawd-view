export type TaskStatus = 'done' | 'active' | 'upcoming'

export type ChecklistTask = {
  id: string
  name: string
  status: TaskStatus
  percent: number
  hasReported: boolean
}

export type ChecklistPhase = 'working' | 'needs-you' | 'stuck' | 'stopped' | 'done'

export type Checklist = {
  title: string
  phase: ChecklistPhase
  tasks: ChecklistTask[]
  needsYouReason: string | null
  stuckReason: string | null
  startedAt: number
  finishedAt: number | null
  isCollapsed: boolean
}

export type StatusLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type StatusUsage = {
  contextPercent?: number
  contextWindow?: number
  // The last reply's context from the transcript, divided by the window when the figure is drawn
  contextTokens?: number
  limits: StatusLimit[]
  costUsd?: number
  // The session's cost as its transcript last recorded it, shown while the live total still reads 0
  historyCost?: number
}

// One reading of the limits: this run's live one, the one saved last run, or the one /usage cached
// 'engine' is the engine's own last reading, from a reply that may be old, so it only fills in (at 0)
export type StatusReading = { source: 'live' | 'saved' | 'usage' | 'engine'; at: number; limits: StatusLimit[] }

// A limit as drawn; isFresh when its window has passed, so a new one starts on the next use
// A passed window has no figure until the next reply brings one (percentUsed undefined)
export type StatusLimitView = Omit<StatusLimit, 'percentUsed'> & { percentUsed: number | undefined; isFresh: boolean }

declare module 'claude-code' {
  interface PluginState {
    'clawd-view': {
      clawdViewEnabled: boolean
      checklist: Checklist | null
      // Whether the running model turn was started by a background notice (outlives a reload)
      isBackgroundTurn: boolean
      tick: number
      draftIsCommand: boolean
      // The status row on top of the box
      statusUsage: StatusUsage | null
      statusModel: string | null
      statusEffort: string | null
      statusNow: number
      statusZone: number | null
      statusIsOn: boolean
      // The right-hand column: tokens and messages this session, when the cache was last refreshed
      statusTokens: { input: number; output: number }
      statusMessages: number
      statusCacheAt: number | null
      // The cache's lifetime from the transcript, the session's first launch, and the saved limit readings
      statusCacheTtl: number | null
      statusStartedAt: number | null
      statusReadings: StatusReading[]
      // The chat with Clawd so far, kept so a reload loses none of it
      'clawd-chat': { history: { role: 'user' | 'clawd' | 'note'; text: string }[] }
    }
  }
}
