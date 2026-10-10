import type { EngineInterface, Register } from 'claude-code'
import { type Git, modelReport, newestChromium, parseOwners, prepRepo, transcriptReport } from './prep.ts'

// repo-prep readies the git repositories a session starts in, once, before
// the first prompt:
// - turns on a repository's tracked .githooks (core.hooksPath), for owners
//   in trustHooksFrom, since a fresh clone leaves them off;
// - fast-forwards a stale local default branch to origin's, so a diff
//   against it shows only the branch's own changes;
// - points CHROME_PATH at Playwright's Chromium where the environment has
//   one (a cloud session) and nothing set it.
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

// Playwright's Chromium, for CHROME_PATH, when it is unset and the
// environment names a Playwright browsers folder that holds one.
async function pointChromePath($: EngineInterface): Promise<string | undefined> {
  if ((await $.env.get('CHROME_PATH')) !== undefined) return undefined
  const browsers = await $.env.get('PLAYWRIGHT_BROWSERS_PATH')
  if (browsers === undefined || !(await $.fs.exists(browsers))) return undefined
  const chromium = newestChromium((await $.fs.list(browsers)).filter(e => e.kind === 'dir').map(e => e.name))
  if (chromium === undefined) return undefined
  for (const build of ['chrome-linux', 'chrome-linux64']) {
    const binary = joinPath(joinPath(joinPath(browsers, chromium), build), 'chrome')
    if (await $.fs.exists(binary)) {
      await $.env.set('CHROME_PATH', binary)
      return binary
    }
  }
  return undefined
}

async function prepare($: EngineInterface, trusted: ReadonlySet<string>) {
  const repos = await findRepos($)
  const results = await Promise.all(
    repos.map(repo =>
      prepRepo(gitIn($, repo), baseName(repo), trusted).catch(error => ({
        name: baseName(repo),
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
