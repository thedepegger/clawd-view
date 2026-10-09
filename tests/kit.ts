// The test kit with a roomier time limit. Each test does real drawing work for every tick of its
// mocked clock, so on a busy machine (a video export, a build) the kit's 5 s default runs out
// before the test does; the limit is only a guard against a hang, so it gets a minute.
import { test as kitTest } from 'claude-code/testing'
import type { TestRest } from 'claude-code/testing'

export * from 'claude-code/testing'

const LIMIT_MS = 60_000

export const test = (name: string, ...rest: TestRest): void => {
  if (rest.length === 1) return kitTest(name, { timeoutMs: LIMIT_MS }, rest[0])
  const [options, body] = rest
  return kitTest(name, { ...options, timeoutMs: Math.max(options.timeoutMs ?? 0, LIMIT_MS) }, body)
}
