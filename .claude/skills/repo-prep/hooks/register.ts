import type { EngineInterface, Register } from 'claude-code'
import {
  type ChromeChange,
  type Git,
  isFullChromium,
  modelReport,
  newestChromium,
  parseOwners,
  pathsNamedUnder,
  prepRepo,
  safeName,
  transcriptReport,
} from './prep.ts'

// repo-prep readies the git repositories a session starts in, once, before
// the first prompt:
// - turns on a repository's tracked .githooks (core.hooksPath), for owners
//   in trustHooksFrom, since a fresh clone leaves them off;
// - fast-forwards a stale local default branch to origin's, so a diff
//   against it shows only the branch's own changes;
// - points CHROME_PATH at Playwright's headless shell where the environment
//   has one (a cloud session): when nothing set it (else at the full
//   Chromium), or in place of a CHROME_PATH that runs the full Chromium.
// It tells the person in one transcript line and the model in a short
// system-prompt section, and /repo-prep runs it again.

// A session that starts above several clones (a cloud session with more than
// one repository) prepares each clone directly beneath it, up to this many.
const MAX_REPOS = 20

const GIT_TIMEOUT_MS = 10_000

const joinPath = (dir: string, name: string) => {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.endsWith(sep) ? dir + name : dir + sep + name
}

const baseName = (path: string) => path.split(/[\\/]/).filter(part => part !== '').pop() ?? path

const gitIn = ($: EngineInterface, repo: string): Git => args =>
  $.process.run(['git', '-C', repo, ...args], {
    timeoutMs: GIT_TIMEOUT_MS,
    // Plain messages to match on, and never a credential prompt.
    env: { LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
  })

async function findRepos($: EngineInterface): Promise<string[]> {
  const root = await $.session.root()
  const top = await gitIn($, root)(['rev-parse', '--show-toplevel'])
  if (top.exitCode === 0 && top.stdout.trim() !== '') return [top.stdout.trim()]
  const repos: string[] = []
  for (const entry of await $.fs.list(root)) {
    if (entry.kind !== 'dir' || repos.length >= MAX_REPOS) continue
    const dir = joinPath(root, entry.name)
    if (await $.fs.exists(joinPath(dir, '.git'))) repos.push(dir)
  }
  return repos
}

// Playwright's headless shell, or else its full Chromium, for CHROME_PATH,
// where the environment names a Playwright browsers folder that holds one. The
// shell comes first: in build 1243 the full Chromium's `--headless=new
// --dump-dom` hangs until killed when it gets a fresh --user-data-dir, as
// test runners give it, while the shell answers in under a second.
// Playwright 1.63 keeps the shell in chrome-headless-shell-linux64 (x64) or
// chrome-headless-shell-linux-arm64; 1.49 kept it in chrome-linux.
const CANDIDATES: ReadonlyArray<{ headlessShell: boolean; builds: string[]; binary: string }> = [
  {
    headlessShell: true,
    builds: ['chrome-headless-shell-linux64', 'chrome-headless-shell-linux-arm64', 'chrome-headless-shell-linux'],
    binary: 'chrome-headless-shell',
  },
  { headlessShell: true, builds: ['chrome-linux'], binary: 'headless_shell' },
  { headlessShell: false, builds: ['chrome-linux', 'chrome-linux64'], binary: 'chrome' },
]

// A script that CHROME_PATH names is read only up to this size; a browser
// binary is far larger.
const MAX_SCRIPT_BYTES = 64 * 1024

const realPathOf = async ($: EngineInterface, path: string) =>
  (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath

// Whether CHROME_PATH runs Playwright's full Chromium from `browsers`: that
// binary, a link to it, or a script naming either. The cloud image's
// /usr/bin/google-chrome is such a script, `exec /opt/pw-browsers/chromium
// "$@"`, where /opt/pw-browsers/chromium links to chromium-1243's chrome.
async function runsFullChromium($: EngineInterface, chromePath: string, browsers: string): Promise<boolean> {
  const base = (await realPathOf($, browsers)) ?? browsers
  const stat = await $.fs.stat(chromePath, { resolve: true }).catch(() => undefined)
  if (stat?.realPath === undefined) return false
  if (isFullChromium(stat.realPath, base)) return true
  if (stat.kind !== 'file' || stat.size > MAX_SCRIPT_BYTES) return false
  const text = await $.fs.read(stat.realPath).catch(() => '')
  if (!text.startsWith('#!')) return false
  for (const named of new Set([...pathsNamedUnder(text, browsers), ...pathsNamedUnder(text, base)])) {
    const real = await realPathOf($, named)
    if (real !== undefined && isFullChromium(real, base)) return true
  }
  return false
}

// Points an unset CHROME_PATH at the best browser Playwright's folder holds,
// and one that runs its full Chromium at the headless shell. Any other
// CHROME_PATH is someone's own choice and stays.
async function pointChromePath($: EngineInterface): Promise<ChromeChange | undefined> {
  const current = await $.env.get('CHROME_PATH')
  const browsers = await $.env.get('PLAYWRIGHT_BROWSERS_PATH')
  if (browsers === undefined || !(await $.fs.exists(browsers))) return undefined
  if (current !== undefined && !(await runsFullChromium($, current, browsers))) return undefined
  const names = (await $.fs.list(browsers)).filter(e => e.kind === 'dir').map(e => e.name)
  // Only the shell is worth putting in place of the full Chromium.
  for (const { headlessShell, builds, binary } of CANDIDATES.filter(c => current === undefined || c.headlessShell)) {
    const folder = newestChromium(names, headlessShell)
    if (folder === undefined) continue
    for (const build of builds) {
      const path = joinPath(joinPath(joinPath(browsers, folder), build), binary)
      if (!(await $.fs.exists(path))) continue
      const change: ChromeChange = { path }
      if (current !== undefined) change.replaced = current
      const { deny } = await $.env.set('CHROME_PATH', path)
      if (deny !== undefined) change.deny = deny
      return change
    }
  }
  return undefined
}

async function prepare($: EngineInterface, trusted: ReadonlySet<string>) {
  const repos = await findRepos($)
  const results = await Promise.all(
    repos.map(repo =>
      prepRepo(gitIn($, repo), baseName(repo), trusted).catch(error => ({
        name: safeName(baseName(repo)),
        changed: [],
        left: [`repo-prep failed here: ${String(error).slice(0, 200)}`],
        forModel: [],
      })),
    ),
  )
  const chrome = await pointChromePath($)
  return { transcript: transcriptReport(results, chrome), section: modelReport(results, chrome), repos: repos.length }
}

export const register: Register = (on, options) => {
  const trusted = parseOwners(options.trustHooksFrom)
  // The latest run's note for the model; a reload runs session.start again.
  let section: string | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'repo-prep', description: 'Run repo-prep again and show what it did' })
    // Preparing is a convenience: whatever goes wrong, the session starts.
    try {
      const prepared = await prepare($, trusted)
      section = prepared.section
      if (prepared.transcript !== undefined) $.ui.log(`repo-prep: ${prepared.transcript}`)
    } catch (error) {
      $.ui.log(`repo-prep could not run: ${String(error).slice(0, 200)}`)
    }
    return next(e)
  })

  on('command.run', { command: 'repo-prep' }, async $ => {
    const { transcript, repos, section: note } = await prepare($, trusted)
    section = note
    if (transcript !== undefined) return { text: transcript }
    return { text: repos === 0 ? 'No git repository here.' : 'Nothing to do; every repository is ready.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (section === undefined) return composed
    return { sections: [...composed.sections, { id: 'repo-prep:report', text: section, scope: 'session' }] }
  })
}
