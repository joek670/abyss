import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { type Git, modelReport, newestChromium, ownerOf, parseOwners, prepRepo, transcriptReport } from '../hooks/prep.ts'

// A repository as fake git sees it. Branch counts are local-vs-origin.
type FakeRepo = {
  origin?: string
  hooks?: string // `git ls-files -s -- .githooks` output
  hooksPath?: string // this repository's own (--local)
  globalHooksPath?: string
  originHead?: string
  remote: string[]
  local: Record<string, { ahead: number; behind: number }>
  checkedOut?: string
}

const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' })
const fail = (exitCode: number, stderr = '') => ({ exitCode, stdout: '', stderr })

// Answers the git commands repo-prep runs, and records them; anything else
// throws, so a test notices a command it did not expect.
function fakeGit(repo: FakeRepo, calls: string[][] = []): Git {
  return async args => {
    calls.push([...args])
    const [cmd, ...rest] = args
    const line = args.join(' ')
    if (line === 'remote get-url origin') return repo.origin === undefined ? fail(2, "error: No such remote 'origin'") : ok(repo.origin + '\n')
    if (line === 'ls-files -s -- .githooks') return ok(repo.hooks ?? '')
    if (line === 'config --local --get core.hooksPath') return repo.hooksPath === undefined ? fail(1) : ok(repo.hooksPath + '\n')
    if (line === 'config --global --get core.hooksPath') return repo.globalHooksPath === undefined ? fail(1) : ok(repo.globalHooksPath + '\n')
    if (line === 'config --system --get core.hooksPath') return fail(1)
    if (line === 'config --local core.hooksPath .githooks') {
      repo.hooksPath = '.githooks'
      return ok()
    }
    if (line === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') {
      return repo.originHead === undefined ? fail(1) : ok(`origin/${repo.originHead}\n`)
    }
    if (cmd === 'rev-parse' && rest[0] === '--verify') {
      const ref = rest[2] ?? ''
      const remote = /^refs\/remotes\/origin\/(.+)$/.exec(ref)?.[1]
      const local = /^refs\/heads\/(.+)$/.exec(ref)?.[1]
      if (remote !== undefined) return repo.remote.includes(remote) ? ok('abc\n') : fail(1)
      if (local !== undefined) return repo.local[local] !== undefined ? ok('abc\n') : fail(1)
    }
    if (cmd === 'rev-list') {
      const branch = /^refs\/heads\/(.+)\.\.\./.exec(rest[2] ?? '')?.[1] ?? ''
      const counts = repo.local[branch]
      return counts === undefined ? fail(128, 'fatal: bad revision') : ok(`${counts.ahead}\t${counts.behind}\n`)
    }
    if (cmd === 'fetch') {
      const branch = /^refs\/remotes\/origin\/(.+):refs\/heads\/\1$/.exec(rest[2] ?? '')?.[1] ?? ''
      const counts = repo.local[branch]
      if (counts === undefined) return fail(128, 'fatal: invalid refspec')
      if (repo.checkedOut === branch) return fail(128, `fatal: refusing to fetch into branch 'refs/heads/${branch}' checked out at '/r'`)
      if (counts.ahead > 0) return fail(1, ` ! [rejected]        origin/${branch} -> ${branch}  (non-fast-forward)`)
      counts.behind = 0
      return ok()
    }
    throw new Error(`fake git does not know: git ${line}`)
  }
}

const HOOKS = '100644 aaa 0\t.githooks/README.md\n100755 bbb 0\t.githooks/pre-commit\n'
const MINE = new Set(['joek670'])

const repo = (over: Partial<FakeRepo> = {}): FakeRepo => ({
  origin: 'https://github.com/joek670/ai-tools',
  hooks: HOOKS,
  remote: ['master'],
  local: { master: { ahead: 0, behind: 0 } },
  ...over,
})

describe('git hooks', () => {
  test("turns on a trusted owner's tracked .githooks", async () => {
    const r = repo()
    const out = await prepRepo(fakeGit(r), 'ai-tools', MINE)
    expect(r.hooksPath).toBe('.githooks')
    expect(out.changed).toContain('turned on its git hooks in .githooks')
    expect(out.forModel.join(' ')).toContain('git commit runs the hooks in .githooks/')
  })

  test("leaves another owner's hooks off, and says why", async () => {
    const calls: string[][] = []
    const r = repo({ origin: 'https://github.com/someone/thing.git' })
    const out = await prepRepo(fakeGit(r, calls), 'thing', MINE)
    expect(r.hooksPath).toBeUndefined()
    expect(calls.some(c => c.join(' ') === 'config --local core.hooksPath .githooks')).toBe(false)
    expect(out.left.join(' ')).toContain('left off because its owner (someone) is not in trustHooksFrom')
  })

  test('leaves hooks off without an origin', async () => {
    const r = repo({ origin: undefined })
    const out = await prepRepo(fakeGit(r), 'x', MINE)
    expect(r.hooksPath).toBeUndefined()
    expect(out.left.join(' ')).toContain('owner (unknown)')
  })

  test('says so when they are already on, and changes nothing', async () => {
    const calls: string[][] = []
    const out = await prepRepo(fakeGit(repo({ hooksPath: '.githooks/' }), calls), 'ai-tools', MINE)
    expect(calls.some(c => c.join(' ') === 'config --local core.hooksPath .githooks')).toBe(false)
    expect(out.left).toContain('its .githooks hooks were already on')
    expect(out.changed).toEqual([])
  })

  test('never replaces a hooksPath someone else set', async () => {
    const r = repo({ hooksPath: '.husky' })
    const out = await prepRepo(fakeGit(r), 'ai-tools', MINE)
    expect(r.hooksPath).toBe('.husky')
    expect(out.left.join(' ')).toContain('core.hooksPath is already .husky')
  })

  test('never overrides a hooksPath set for every repository in your git config', async () => {
    const r = repo({ globalHooksPath: '~/.git-hooks' })
    const out = await prepRepo(fakeGit(r), 'ai-tools', MINE)
    expect(r.hooksPath).toBeUndefined()
    expect(out.left.join(' ')).toContain('your git config sets core.hooksPath to ~/.git-hooks for every repository')
  })

  test('does nothing about hooks in a repository that tracks none', async () => {
    const r = repo({ hooks: '' })
    const out = await prepRepo(fakeGit(r), 'abyss', MINE)
    expect(r.hooksPath).toBeUndefined()
    expect(out).toEqual({ name: 'abyss', changed: [], left: [], forModel: [] })
  })

  test('warns about a hook git will not run because it is not executable', async () => {
    const out = await prepRepo(fakeGit(repo({ hooks: '100644 aaa 0\t.githooks/pre-commit\n100644 bbb 0\t.githooks/README.md\n' })), 'ai-tools', MINE)
    expect(out.left.join(' ')).toContain('.githooks/pre-commit not executable in git')
    expect(out.left.join(' ')).not.toContain('README')
  })
})

describe('stale default branch', () => {
  test('fast-forwards a local default branch that is only behind', async () => {
    const r = repo({ local: { master: { ahead: 0, behind: 3 } } })
    const out = await prepRepo(fakeGit(r), 'ai-tools', MINE)
    expect(r.local.master?.behind).toBe(0)
    expect(out.changed).toContain('fast-forwarded local master by 3 commits to origin/master')
  })

  test('leaves it when it is checked out, and tells the model to compare against origin', async () => {
    const r = repo({ local: { master: { ahead: 0, behind: 1 } }, checkedOut: 'master' })
    const out = await prepRepo(fakeGit(r), 'ai-tools', MINE)
    expect(r.local.master?.behind).toBe(1)
    expect(out.left.join(' ')).toContain('local master is 1 commit behind origin/master but checked out')
    expect(out.forModel.join(' ')).toContain('compare against origin/master')
  })

  test('never moves a branch that has diverged', async () => {
    const calls: string[][] = []
    const out = await prepRepo(fakeGit(repo({ local: { master: { ahead: 2, behind: 5 } } }), calls), 'ai-tools', MINE)
    expect(calls.some(c => c[0] === 'fetch')).toBe(false)
    expect(out.left.join(' ')).toContain('have diverged (2 ahead, 5 behind)')
  })

  test('does nothing when the branch is current, or absent locally', async () => {
    const current = await prepRepo(fakeGit(repo({ hooks: '' })), 'a', MINE)
    expect(current.changed).toEqual([])
    const absent = await prepRepo(fakeGit(repo({ hooks: '', local: {} })), 'b', MINE)
    expect(absent).toEqual({ name: 'b', changed: [], left: [], forModel: [] })
  })

  test("follows origin/HEAD, then main, then master", async () => {
    const develop = repo({ hooks: '', originHead: 'develop', remote: ['develop', 'main'], local: { develop: { ahead: 0, behind: 2 } } })
    expect((await prepRepo(fakeGit(develop), 'r', MINE)).changed).toContain('fast-forwarded local develop by 2 commits to origin/develop')
    const main = repo({ hooks: '', remote: ['main', 'master'], local: { main: { ahead: 0, behind: 1 } } })
    expect((await prepRepo(fakeGit(main), 'r', MINE)).changed).toContain('fast-forwarded local main by 1 commit to origin/main')
  })
})

describe('parsing', () => {
  test('ownerOf reads the owner from every remote spelling', () => {
    expect(ownerOf('https://github.com/joek670/ai-tools')).toBe('joek670')
    expect(ownerOf('https://github.com/JoeK670/abyss.git\n')).toBe('joek670')
    expect(ownerOf('git@github.com:joek670/abyss.git')).toBe('joek670')
    expect(ownerOf('ssh://git@github.com/joek670/abyss/')).toBe('joek670')
    expect(ownerOf('http://local_proxy@127.0.0.1:41234/git/joek670/ai-tools')).toBe('joek670')
    expect(ownerOf('abyss')).toBeUndefined()
  })

  test('parseOwners splits on commas and spaces, ignoring case', () => {
    expect([...parseOwners(' JoeK670, acme  other,,')]).toEqual(['joek670', 'acme', 'other'])
    expect([...parseOwners(['a', 'B'])]).toEqual(['a', 'b'])
    expect([...parseOwners(undefined)]).toEqual([])
  })

  test('newestChromium picks the highest build and skips the headless shell', () => {
    expect(newestChromium(['ffmpeg-1011', 'chromium_headless_shell-1194', 'chromium-1181', 'chromium-1194'])).toBe('chromium-1194')
    expect(newestChromium(['firefox-1490'])).toBeUndefined()
  })

  test('reports say nothing when nothing happened', () => {
    const quiet = [{ name: 'a', changed: [], left: [], forModel: [] }]
    expect(transcriptReport(quiet, undefined)).toBeUndefined()
    expect(modelReport(quiet, undefined)).toBeUndefined()
    expect(transcriptReport(quiet, '/c')).toBe('set CHROME_PATH to /c')
  })
})

// The session as a whole: a fake host beneath the mod answering every call it makes.

type Host = {
  root: string
  entries?: { name: string; kind: 'file' | 'dir' | 'other' }[]
  repos: Record<string, FakeRepo>
  env: Record<string, string | undefined>
  browsers?: string[]
  files?: string[]
  failRepo?: string
}

function fakeHost(on: On, host: Host) {
  const logs: string[] = []
  const envSets: Record<string, string | undefined> = {}
  const registered: string[] = []
  on('process.run', async ($, e) => {
    const [exe, flag, dir, ...args] = e.argv
    if (exe !== 'git' || flag !== '-C' || dir === undefined) throw new Error(`unexpected command ${e.argv.join(' ')}`)
    if (args.join(' ') === 'rev-parse --show-toplevel') {
      return { value: host.repos[dir] !== undefined ? { ...ok(dir + '\n'), isStdoutTruncated: false, isStderrTruncated: false } : { ...fail(128, 'fatal: not a git repository'), isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (dir === host.failRepo) throw new Error('git timed out')
    const fake = host.repos[dir]
    if (fake === undefined) throw new Error(`no fake repository at ${dir}`)
    return { value: { ...(await fakeGit(fake)(args)), isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.root', async () => ({ value: host.root }))
  on('fs.list', async ($, e) => {
    if (e.path === host.root) {
      if (host.entries === undefined) throw new Error('EACCES: permission denied')
      return { value: host.entries.map(x => ({ ...x, size: 0, mtimeMs: 0, isLink: false })) }
    }
    if (e.path === host.env.PLAYWRIGHT_BROWSERS_PATH) return { value: (host.browsers ?? []).map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
    throw new Error(`fs.list ${e.path}`)
  })
  on('fs.exists', async ($, e) => ({ value: (host.files ?? []).includes(e.path) }))
  on('env.get', async ($, e) => ({ value: host.env[e.name] }))
  on('env.set', async ($, e) => {
    envSets[e.name] = e.value
    return { value: undefined }
  })
  on('command.register', async ($, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', async ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  // Events answer with their result; the calls above answer with { value }.
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' as const }] }))
  return { logs, envSets, registered }
}

const CLOUD: Omit<Host, 'repos'> = {
  root: '/home/user',
  entries: [
    { name: 'ai-tools', kind: 'dir' },
    { name: 'abyss', kind: 'dir' },
    { name: 'anthropics', kind: 'dir' },
    { name: 'notes.txt', kind: 'file' },
  ],
  env: { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' },
  browsers: ['chromium-1194', 'chromium_headless_shell-1194', 'ffmpeg-1011'],
  files: ['/home/user/ai-tools/.git', '/home/user/abyss/.git', '/opt/pw-browsers', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'],
}

const START = { cwd: '/home/user', surface: null, isInteractive: false } as const

// A system prompt being composed for the main loop.
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: ['Bash'], outputStyle: null, traits: [] } as const

// How the person's typed /repo-prep reaches the mod.
const TYPED = { command: 'repo-prep', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

describe('a session', () => {
  test('prepares every clone beneath a multi-repo root and tells the person and the model', async ($, on) => {
    const aiTools = repo({ local: { master: { ahead: 0, behind: 4 } } })
    const abyss = repo({ origin: 'https://github.com/joek670/abyss', hooks: '', remote: ['main'], local: { main: { ahead: 0, behind: 0 } } })
    const { logs, envSets, registered } = fakeHost(on, { ...CLOUD, repos: { '/home/user/ai-tools': aiTools, '/home/user/abyss': abyss } })
    await $.session.start(START)
    expect(registered).toEqual(['repo-prep'])
    expect(aiTools.hooksPath).toBe('.githooks')
    expect(aiTools.local.master?.behind).toBe(0)
    expect(envSets.CHROME_PATH).toBe('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('repo-prep: ai-tools: turned on its git hooks in .githooks; fast-forwarded local master by 4 commits')
    expect(logs[0]).toContain('set CHROME_PATH to /opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    expect(logs[0]).not.toContain('abyss')
    const { sections } = await $.prompt.compose(COMPOSE)
    const note = sections.find(s => s.id === 'repo-prep:report')
    expect(note?.scope).toBe('session')
    expect(note?.text).toContain('ai-tools: git commit runs the hooks in .githooks/')
    expect(note?.text).toContain('CHROME_PATH is set to /opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    expect(sections[0]?.id).toBe('intro')
  })

  test('prepares just the repository a session starts in', async ($, on) => {
    const aiTools = repo({ local: { master: { ahead: 0, behind: 1 } } })
    fakeHost(on, { root: '/w/ai-tools', repos: { '/w/ai-tools': aiTools }, env: {} })
    await $.session.start({ ...START, cwd: '/w/ai-tools' })
    expect(aiTools.hooksPath).toBe('.githooks')
    expect(aiTools.local.master?.behind).toBe(0)
  })

  test('leaves a CHROME_PATH that is already set', async ($, on) => {
    const { envSets } = fakeHost(on, {
      ...CLOUD,
      entries: [],
      env: { ...CLOUD.env, CHROME_PATH: '/usr/bin/google-chrome' },
      repos: {},
    })
    await $.session.start(START)
    expect(envSets).toEqual({})
  })

  test('honours trustHooksFrom', { options: { trustHooksFrom: 'acme' } }, async ($, on) => {
    const aiTools = repo()
    const { logs } = fakeHost(on, { root: '/w/ai-tools', repos: { '/w/ai-tools': aiTools }, env: {} })
    await $.session.start({ ...START, cwd: '/w/ai-tools' })
    expect(aiTools.hooksPath).toBeUndefined()
    expect(logs[0]).toContain('owner (joek670) is not in trustHooksFrom')
  })

  test('one repository failing leaves the others prepared', async ($, on) => {
    const aiTools = repo({ local: { master: { ahead: 0, behind: 2 } } })
    const { logs } = fakeHost(on, { ...CLOUD, failRepo: '/home/user/abyss', repos: { '/home/user/ai-tools': aiTools, '/home/user/abyss': repo() } })
    await $.session.start(START)
    expect(aiTools.local.master?.behind).toBe(0)
    expect(logs[0]).toContain('abyss: repo-prep failed here')
  })

  test('the session starts even when preparing fails outright', async ($, on) => {
    const { logs, registered } = fakeHost(on, { ...CLOUD, entries: undefined, repos: {} })
    const started = await $.session.start(START)
    expect(started).toEqual({ cwd: '/home/user' })
    expect(registered).toEqual(['repo-prep'])
    expect(logs.join(' ')).toContain('repo-prep could not run')
  })

  test('/repo-prep runs it again and answers with what it did', async ($, on) => {
    const aiTools = repo({ hooks: '', local: { master: { ahead: 0, behind: 2 } } })
    fakeHost(on, { root: '/w/ai-tools', repos: { '/w/ai-tools': aiTools }, env: {} })
    const first = await $.command.run(TYPED)
    expect(first.text).toContain('fast-forwarded local master by 2 commits')
    const second = await $.command.run(TYPED)
    expect(second.text).toBe('Nothing to do; every repository is ready.')
  })
})
