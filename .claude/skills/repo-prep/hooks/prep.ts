// What repo-prep does to one repository, written against a `git` function
// so it reads (and tests) without a session. register.ts supplies the real
// one and assembles the report.

export type GitResult = { exitCode: number; stdout: string; stderr: string }

// Runs git in one repository: the arguments after `git -C <repo>`.
export type Git = (args: readonly string[]) => Promise<GitResult>

export type RepoResult = {
  name: string
  // What repo-prep changed, for the person.
  changed: string[]
  // What it left alone and why, for the person.
  left: string[]
  // What the model should know while it works in this repository.
  forModel: string[]
}

const HOOKS_DIR = '.githooks'

// The hook names git runs; anything else in .githooks (a README) is not one.
const HOOK_NAMES = new Set([
  'applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit',
  'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-rebase', 'post-checkout', 'post-merge',
  'pre-push', 'pre-receive', 'update', 'proc-receive', 'post-receive', 'post-update',
  'reference-transaction', 'push-to-checkout', 'pre-auto-gc', 'post-rewrite', 'sendemail-validate',
  'fsmonitor-watchman', 'p4-changelist', 'p4-prepare-changelist', 'p4-post-changelist', 'p4-pre-submit',
  'post-index-change',
])

// The GitHub owner of a remote, or undefined when the remote is not on
// GitHub: https://github.com/OWNER/repo(.git), git@github.com:OWNER/repo.git,
// ssh://git@github.com/OWNER/repo, or a cloud session's loopback git proxy
// (http://...@127.0.0.1:PORT/git/OWNER/repo). Only GitHub counts, so a
// same-named owner on another host, or a local path that happens to contain
// the name, never earns trust.
export function githubOwnerOf(url: string): string | undefined {
  const text = url.trim()
  const scp = /^[\w.-]+@([\w.-]+):([^/\s]+)\/[^/\s]+?(?:\.git)?\/?$/.exec(text)
  if (scp !== null) return scp[1]?.toLowerCase() === 'github.com' ? scp[2]?.toLowerCase() : undefined
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return undefined
  }
  const parts = parsed.pathname.replace(/\.git$/, '').split('/').filter(part => part !== '')
  const host = parsed.hostname.toLowerCase()
  if (host === 'github.com' && parts.length === 2) return parts[0]?.toLowerCase()
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]'
  if (isLoopback && parts.length === 3 && parts[0] === 'git') return parts[1]?.toLowerCase()
  return undefined
}

// Names that reach the model's system prompt keep to what git and GitHub
// allow in a ref or repository name; anything else is replaced.
export const safeName = (name: string) => name.replace(/[^\w.\/-]/g, '_').slice(0, 100)

export function parseOwners(option: unknown): Set<string> {
  const text = typeof option === 'string' ? option : Array.isArray(option) ? option.join(',') : ''
  return new Set(text.split(/[\s,]+/).map(owner => owner.trim().toLowerCase()).filter(owner => owner !== ''))
}

// The highest-numbered Playwright Chromium folder (chromium-1194), not the
// headless shell; undefined when there is none.
export function newestChromium(names: readonly string[]): string | undefined {
  return names
    .map(name => ({ name, build: /^chromium-(\d+)$/.exec(name)?.[1] }))
    .filter((entry): entry is { name: string; build: string } => entry.build !== undefined)
    .sort((a, b) => Number(b.build) - Number(a.build))[0]?.name
}

async function turnOnHooks(git: Git, owner: string | undefined, trusted: ReadonlySet<string>, out: RepoResult) {
  const tracked = await git(['ls-files', '-s', '--', HOOKS_DIR])
  if (tracked.exitCode !== 0 || tracked.stdout.trim() === '') return
  // Read each scope's own value: Claude Code runs a mod's git with
  // core.hooksPath=/dev/null injected, which a plain --get would report.
  const configured = async (scope: '--local' | '--global' | '--system') => {
    const read = await git(['config', scope, '--get', 'core.hooksPath'])
    return read.exitCode === 0 ? read.stdout.trim() : ''
  }
  const local = await configured('--local')
  if (local !== '') {
    if (local.replace(/\/+$/, '') === HOOKS_DIR) {
      out.left.push(`its ${HOOKS_DIR} hooks were already on`)
      out.forModel.push(`git commit runs the hooks in ${HOOKS_DIR}/.`)
    } else {
      out.left.push(`core.hooksPath is already ${local}, so ${HOOKS_DIR} was left off`)
    }
    return
  }
  const outer = (await configured('--global')) || (await configured('--system'))
  if (outer !== '') {
    out.left.push(`your git config sets core.hooksPath to ${outer} for every repository, so ${HOOKS_DIR} was left off`)
    return
  }
  if (owner === undefined || !trusted.has(owner)) {
    out.left.push(
      owner === undefined
        ? `it tracks hooks in ${HOOKS_DIR}, left off because its origin is not on GitHub`
        : `it tracks hooks in ${HOOKS_DIR}, left off because its owner (${owner}) is not in trustHooksFrom`,
    )
    return
  }
  const set = await git(['config', '--local', 'core.hooksPath', HOOKS_DIR])
  if (set.exitCode !== 0) {
    out.left.push(`turning on ${HOOKS_DIR} failed: ${set.stderr.trim().slice(0, 200)}`)
    return
  }
  out.changed.push(`turned on its git hooks in ${HOOKS_DIR}`)
  out.forModel.push(`git commit runs the hooks in ${HOOKS_DIR}/; fix what a hook rejects rather than bypassing it.`)
  // `git ls-files -s` lines read "<mode> <sha> <stage>\t<path>".
  const unrunnable = tracked.stdout
    .split('\n')
    .map(line => line.split('\t'))
    .filter(([meta, path]) => path !== undefined && meta?.startsWith('100644') === true)
    .map(([, path]) => path as string)
    .filter(path => HOOK_NAMES.has(path.slice(HOOKS_DIR.length + 1)))
  if (unrunnable.length > 0) out.left.push(`${unrunnable.join(', ')} not executable in git, so git skips it on Linux and macOS`)
}

async function defaultBranch(git: Git): Promise<string | undefined> {
  const head = await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  const named = head.stdout.trim()
  if (head.exitCode === 0 && named.startsWith('origin/') && safeName(named) === named) return named.slice('origin/'.length)
  for (const branch of ['main', 'master']) {
    if ((await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])).exitCode === 0) return branch
  }
  return undefined
}

async function fastForwardBase(git: Git, out: RepoResult) {
  const base = await defaultBranch(git)
  if (base === undefined) return
  const local = `refs/heads/${base}`
  const remote = `refs/remotes/origin/${base}`
  if ((await git(['rev-parse', '--verify', '--quiet', local])).exitCode !== 0) return
  const counts = await git(['rev-list', '--left-right', '--count', `${local}...${remote}`])
  const [ahead = NaN, behind = NaN] = counts.stdout.trim().split(/\s+/).map(Number)
  if (counts.exitCode !== 0 || Number.isNaN(ahead) || Number.isNaN(behind)) return
  if (behind === 0) return
  const commits = `${behind} commit${behind === 1 ? '' : 's'}`
  if (ahead > 0) {
    out.left.push(`local ${base} and origin/${base} have diverged (${ahead} ahead, ${behind} behind), so it was not moved`)
    out.forModel.push(`Local ${base} has diverged from origin/${base}; compare against origin/${base}.`)
    return
  }
  // Fetching from the repository itself moves the branch only as a fast
  // forward, and git refuses to move a branch that is checked out.
  const moved = await git(['fetch', '--quiet', '.', `${remote}:${local}`])
  if (moved.exitCode === 0) {
    out.changed.push(`fast-forwarded local ${base} by ${commits} to origin/${base}`)
    return
  }
  if (/checked out/i.test(moved.stderr)) {
    out.left.push(`local ${base} is ${commits} behind origin/${base} but checked out, so it was not moved`)
  } else {
    out.left.push(`local ${base} is ${commits} behind origin/${base}; moving it failed: ${moved.stderr.trim().slice(0, 200)}`)
  }
  out.forModel.push(`Local ${base} is behind origin/${base}; compare against origin/${base}.`)
}

export async function prepRepo(git: Git, name: string, trusted: ReadonlySet<string>): Promise<RepoResult> {
  const out: RepoResult = { name: safeName(name), changed: [], left: [], forModel: [] }
  const origin = await git(['remote', 'get-url', 'origin'])
  const owner = origin.exitCode === 0 ? githubOwnerOf(origin.stdout) : undefined
  await turnOnHooks(git, owner, trusted, out)
  await fastForwardBase(git, out)
  return out
}

// What happened, one clause per repository, for the transcript line and the
// command's reply; undefined when nothing happened anywhere worth saying.
export function transcriptReport(results: readonly RepoResult[], chrome: string | undefined): string | undefined {
  const lines = results
    .filter(r => r.changed.length + r.left.length > 0)
    .map(r => `${r.name}: ${[...r.changed, ...r.left].join('; ')}`)
  if (chrome !== undefined) lines.push(`set CHROME_PATH to ${chrome}`)
  return lines.length === 0 ? undefined : lines.join(' · ')
}

// The system-prompt section: only what changes how the model should work.
export function modelReport(results: readonly RepoResult[], chrome: string | undefined): string | undefined {
  const lines = results.flatMap(r => r.forModel.map(line => `- ${r.name}: ${line}`))
  if (chrome !== undefined) lines.push(`- CHROME_PATH is set to ${chrome} for the commands you run, so browser test suites find Chromium.`)
  return lines.length === 0 ? undefined : ['# Repository prep (repo-prep mod)', ...lines].join('\n')
}
