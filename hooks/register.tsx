import type { Register } from 'claude-code'

// @ts-expect-error the mascot is plain JavaScript, with no types of its own
import { register as registerClawd } from './clawd.js'
import { registerClawdView } from './clawd-view'

// One entry point for both: Clawd View (the checklist and stats) and Clawd (the mascot).
// Clawd View goes first, so Clawd draws beneath it and reaches it as `rest`: the box sits above
// Clawd and can trim him when the rows run out, as when they were two mods.
export const register: Register = (on, options) => {
  registerClawdView(on)
  registerClawd(on, options)
}
