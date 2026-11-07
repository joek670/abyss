// The rules ship-gate judges a pull request by, kept apart from the GitHub
// calls so they read (and test) as plain functions.

export const CONFIG_PATH = '.claude/ship-gate.json'

// The gate's rules file is held in every repository that opts in, so only a
// person can loosen the rules. Its code is held too, unless the rules say
// `"holdGateCode": false`; that setting can only arrive in a merge a person
// makes, since the rules file itself is always held.
const GATE_CODE = '.claude/skills/ship-gate/'

const PASSING = new Set(['success', 'neutral', 'skipped'])

export type Config = {
  holdDeletions: boolean
  holdPaths: string[]
  holdAddedLines: { name: string; pattern: RegExp }[]
  requireGreenChecks: boolean
  holdGateCode: boolean
}

export type PullRequestFile = {
  filename: string
  status: string
  previous_filename?: string
  patch?: string
}

export type CheckRun = { name: string; status: string; conclusion: string | null }

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(item => typeof item === 'string')

export function parseConfig(text: string): Config {
  const raw: unknown = JSON.parse(text)
  if (!isRecord(raw)) throw new Error(`${CONFIG_PATH} is not a JSON object`)
  const known = ['$comment', 'holdDeletions', 'holdPaths', 'holdAddedLines', 'requireGreenChecks', 'holdGateCode']
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) throw new Error(`${CONFIG_PATH} has an unknown key "${key}"`)
  }
  const { holdDeletions = false, holdPaths = [], holdAddedLines = [], requireGreenChecks = false, holdGateCode = true } = raw
  if (typeof holdDeletions !== 'boolean') throw new Error('holdDeletions is not true or false')
  if (typeof holdGateCode !== 'boolean') throw new Error('holdGateCode is not true or false')
  if (typeof requireGreenChecks !== 'boolean') throw new Error('requireGreenChecks is not true or false')
  if (!isStringList(holdPaths)) throw new Error('holdPaths is not a list of paths')
  if (!Array.isArray(holdAddedLines)) throw new Error('holdAddedLines is not a list')
  return {
    holdDeletions,
    requireGreenChecks,
    holdGateCode,
    holdPaths,
    holdAddedLines: holdAddedLines.map(entry => {
      if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.pattern !== 'string') {
        throw new Error('each holdAddedLines entry needs a "name" and a "pattern"')
      }
      return { name: entry.name, pattern: new RegExp(entry.pattern) }
    }),
  }
}

// A rule ending in "/" holds everything under that folder; any other rule
// holds that one path, from the repository root.
const heldBy = (path: string, rules: readonly string[]) =>
  rules.find(rule => (rule.endsWith('/') ? path.startsWith(rule) : path === rule))

export function reasonsFromFiles(config: Config, files: readonly PullRequestFile[]): string[] {
  const rules = [CONFIG_PATH, ...(config.holdGateCode ? [GATE_CODE] : []), ...config.holdPaths]
  const reasons: string[] = []
  for (const file of files) {
    if (config.holdDeletions && file.status === 'removed') reasons.push(`deletes ${file.filename}`)
    for (const path of [file.filename, file.previous_filename]) {
      const rule = path === undefined ? undefined : heldBy(path, rules)
      if (rule !== undefined) reasons.push(`touches ${path} (held: ${rule})`)
    }
    if (config.holdAddedLines.length === 0 || file.status === 'removed') continue
    if (file.patch === undefined) {
      // GitHub omits the patch of a binary or very large file, and of a pure rename.
      if (file.status !== 'renamed') {
        reasons.push(`changes ${file.filename}, whose diff GitHub does not show, so it could not be checked for secrets`)
      }
      continue
    }
    const added = file.patch.split('\n').filter(line => line.startsWith('+'))
    for (const { name, pattern } of config.holdAddedLines) {
      // Name the pattern, never the line: the line may be the secret.
      if (added.some(line => pattern.test(line))) reasons.push(`adds a line in ${file.filename} that looks like a ${name}`)
    }
  }
  return [...new Set(reasons)]
}

export function reasonsFromChecks(sha: string, runs: readonly CheckRun[]): string[] {
  if (runs.length === 0) return [`has no checks reported on ${sha.slice(0, 7)} yet`]
  return runs
    .filter(run => run.status !== 'completed' || !PASSING.has(run.conclusion ?? ''))
    .map(run =>
      run.status === 'completed'
        ? `has check "${run.name}" ending ${run.conclusion ?? 'without a result'}`
        : `has check "${run.name}" still ${run.status.replace('_', ' ')}`,
    )
}
