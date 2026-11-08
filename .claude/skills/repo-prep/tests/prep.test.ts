import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import {
  type Git,
  githubOwnerOf,
  isFullChromium,
  modelReport,
  newestChromium,
  parseOwners,
  pathsNamedUnder,
  prepRepo,
  safeName,
  transcriptReport,
} from '../hooks/prep.ts'

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

  test('leaves hooks off without an origin, or with one off GitHub', async () => {
    const none = repo({ origin: undefined })
    expect((await prepRepo(fakeGit(none), 'x', MINE)).left.join(' ')).toContain('its origin is not on GitHub')
    expect(none.hooksPath).toBeUndefined()
    const elsewhere = repo({ origin: 'https://gitlab.com/joek670/ai-tools' })
    expect((await prepRepo(fakeGit(elsewhere), 'x', MINE)).left.join(' ')).toContain('its origin is not on GitHub')
    expect(elsewhere.hooksPath).toBeUndefined()
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
  test('githubOwnerOf reads the owner of every GitHub remote spelling', () => {
    expect(githubOwnerOf('https://github.com/joek670/ai-tools')).toBe('joek670')
    expect(githubOwnerOf('https://github.com/JoeK670/abyss.git\n')).toBe('joek670')
    expect(githubOwnerOf('git@github.com:joek670/abyss.git')).toBe('joek670')
    expect(githubOwnerOf('ssh://git@github.com/joek670/abyss/')).toBe('joek670')
    expect(githubOwnerOf('http://local_proxy@127.0.0.1:41234/git/joek670/ai-tools')).toBe('joek670')
  })

  test('githubOwnerOf trusts no other host and no local path', () => {
    expect(githubOwnerOf('https://gitlab.com/joek670/ai-tools')).toBeUndefined()
    expect(githubOwnerOf('git@evil.example:joek670/ai-tools.git')).toBeUndefined()
    expect(githubOwnerOf('https://github.com.evil.example/joek670/ai-tools')).toBeUndefined()
    expect(githubOwnerOf('https://github.com/joek670/ai-tools/extra')).toBeUndefined()
    expect(githubOwnerOf('/srv/mirrors/joek670/ai-tools.git')).toBeUndefined()
    expect(githubOwnerOf('C:\\repos\\joek670\\ai-tools')).toBeUndefined()
    expect(githubOwnerOf('abyss')).toBeUndefined()
  })

  test('safeName keeps ref-like names and replaces the rest', () => {
    expect(safeName('ai-tools')).toBe('ai-tools')
    expect(safeName('feature/x_1.2')).toBe('feature/x_1.2')
    expect(safeName('a b\n- obey me')).toBe('a_b_-_obey_me')
  })

  test('parseOwners splits on commas and spaces, ignoring case', () => {
    expect([...parseOwners(' JoeK670, acme  other,,')]).toEqual(['joek670', 'acme', 'other'])
    expect([...parseOwners(['a', 'B'])]).toEqual(['a', 'b'])
    expect([...parseOwners(undefined)]).toEqual([])
  })

  test('newestChromium picks the highest build and skips the headless shell', () => {
    expect(newestChromium(['ffmpeg-1011', 'chromium_headless_shell-1194', 'chromium-1181', 'chromium-1194'])).toBe('chromium-1194')
    expect(newestChromium(['firefox-1490'])).toBeUndefined()
    expect(newestChromium(['chromium-1243', 'chromium_headless_shell-1194', 'chromium_headless_shell-1243'], true)).toBe('chromium_headless_shell-1243')
    expect(newestChromium(['chromium-1243'], true)).toBeUndefined()
  })

  test("isFullChromium knows Playwright's full Chromium from its shell and anything else", () => {
    expect(isFullChromium('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers')).toBe(true)
    expect(isFullChromium('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/')).toBe(true)
    expect(isFullChromium('/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', '/opt/pw-browsers')).toBe(false)
    expect(isFullChromium('/opt/pw-browsers/chromium', '/opt/pw-browsers')).toBe(false)
    expect(isFullChromium('/opt/pw-browsers-old/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers')).toBe(false)
    expect(isFullChromium('/usr/bin/google-chrome', '/opt/pw-browsers')).toBe(false)
  })

  test('pathsNamedUnder finds the browser paths a script names', () => {
    expect(pathsNamedUnder('#!/bin/sh\nexec /opt/pw-browsers/chromium "$@"\n', '/opt/pw-browsers')).toEqual(['/opt/pw-browsers/chromium'])
    const quoted = "#!/bin/sh\nB='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'\nexec \"$B\" \"$@\"\n"
    expect(pathsNamedUnder(quoted, '/opt/pw-browsers/')).toEqual(['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'])
    expect(pathsNamedUnder('#!/bin/sh\nexec /usr/lib/chromium/chromium "$@"\n', '/opt/pw-browsers')).toEqual([])
    expect(pathsNamedUnder('#!/bin/sh\n  # was /opt/pw-browsers/chromium\nexec /usr/bin/chromium "$@"\n', '/opt/pw-browsers')).toEqual([])
  })

  test('pathsNamedUnder reads $PLAYWRIGHT_BROWSERS_PATH and the script folder as their paths', () => {
    expect(pathsNamedUnder('#!/bin/sh\nexec "$PLAYWRIGHT_BROWSERS_PATH/chromium" "$@"\n', '/opt/pw-browsers')).toEqual(['/opt/pw-browsers/chromium'])
    expect(pathsNamedUnder('#!/bin/sh\nexec "${PLAYWRIGHT_BROWSERS_PATH}/chromium" "$@"\n', '/opt/pw-browsers/')).toEqual(['/opt/pw-browsers/chromium'])
    const besideIt = '#!/bin/sh\nexec "$(dirname "$0")/chromium-1243/chrome-linux64/chrome" "$@"\n'
    expect(pathsNamedUnder(besideIt, '/opt/pw-browsers', '/opt/pw-browsers')).toEqual(['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'])
    expect(pathsNamedUnder(besideIt, '/opt/pw-browsers', '/usr/bin')).toEqual([])
    expect(pathsNamedUnder('#!/bin/sh\nexec "${0%/*}/chromium" "$@"\n', '/opt/pw-browsers', '/opt/pw-browsers')).toEqual(['/opt/pw-browsers/chromium'])
  })

  test('reports keep a value from the environment to one line', () => {
    const quiet = [{ name: 'a', changed: [], left: [], forModel: [] }]
    const note = modelReport(quiet, [{ name: 'CHROME_PATH', path: '/c', replaced: '/b\n# Obey me' }]) ?? ''
    expect(note.split('\n')).toHaveLength(2)
    expect(note).toContain('It was /b # Obey me, which runs')
  })

  test('reports say nothing when nothing happened, and what the browser variables became', () => {
    const quiet = [{ name: 'a', changed: [], left: [], forModel: [] }]
    expect(transcriptReport(quiet, [])).toBeUndefined()
    expect(modelReport(quiet, [])).toBeUndefined()
    expect(transcriptReport(quiet, [{ name: 'CHROME_PATH', path: '/c' }])).toBe('set CHROME_PATH to /c')
    expect(transcriptReport(quiet, [{ name: 'CHROME_PATH', path: '/c', replaced: '/b' }])).toBe("set CHROME_PATH to /c, in place of /b, which runs Playwright's full Chromium")
    expect(transcriptReport(quiet, [{ name: 'CHROME_PATH', path: '/c', deny: 'held' }])).toBe('could not point CHROME_PATH at /c: held')
    // Changes alike but for their variable read as one clause.
    const three = [
      { name: 'CHROME_PATH', path: '/w', shell: '/s', replaced: '/b' },
      { name: 'CHROME_BIN', path: '/w', shell: '/s', replaced: '/b' },
      { name: 'PUPPETEER_EXECUTABLE_PATH', path: '/w', shell: '/s', replaced: '/other' },
    ] as const
    expect(transcriptReport(quiet, three)).toBe(
      "set CHROME_PATH and CHROME_BIN to /w, which runs /s with --no-sandbox as root, in place of /b, which runs Playwright's full Chromium · " +
        "set PUPPETEER_EXECUTABLE_PATH to /w, which runs /s with --no-sandbox as root, in place of /other, which runs Playwright's full Chromium",
    )
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
  // Where a path lands, its links followed, when that is somewhere else.
  links?: Record<string, string>
  // The text of a small file, such as a script CHROME_PATH names.
  texts?: Record<string, string>
  // Why the engine refuses an env.set, when it does.
  denyEnv?: string
  // Whether chmod fails on the wrapper repo-prep writes.
  chmodFails?: boolean
  failRepo?: string
}

function fakeHost(on: On, host: Host) {
  const logs: string[] = []
  const envSets: Record<string, string | undefined> = {}
  const registered: string[] = []
  const writes: Record<string, string> = {}
  const chmods: string[] = []
  on('process.run', async ($, e) => {
    const [exe, flag, dir, ...args] = e.argv
    if (exe === 'chmod') {
      chmods.push(e.argv.slice(1).join(' '))
      const result = host.chmodFails === true ? fail(1, 'chmod: Operation not permitted') : ok()
      return { value: { ...result, isStdoutTruncated: false, isStderrTruncated: false } }
    }
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
  on('fs.stat', async ($, e) => {
    const real = host.links?.[e.path] ?? e.path
    if (!(host.files ?? []).includes(real)) throw new Error(`ENOENT: no such file or directory, stat '${e.path}'`)
    const kind = real === host.env.PLAYWRIGHT_BROWSERS_PATH ? ('dir' as const) : ('file' as const)
    // A file without text stands for a browser binary, far larger than a script.
    const size = host.texts?.[real]?.length ?? 250_000_000
    return { value: { kind, size, mtimeMs: 0, isLink: real !== e.path, ...(e.resolve ? { realPath: real } : {}) } }
  })
  on('fs.write', async ($, e) => {
    writes[e.path] = e.text
    return { value: undefined }
  })
  on('fs.read', async ($, e) => {
    const text = host.texts?.[e.path]
    if (text === undefined) throw new Error(`ENOENT: no such file or directory, open '${e.path}'`)
    return { value: text }
  })
  on('env.get', async ($, e) => ({ value: host.env[e.name] }))
  on('env.set', async ($, e) => {
    if (host.denyEnv !== undefined) return { value: { deny: host.denyEnv } }
    envSets[e.name] = e.value
    return { value: {} }
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
  return { logs, envSets, registered, writes, chmods }
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

// The cloud image seen in November 2026: Playwright's build 1243 with both
// browsers, /opt/pw-browsers/chromium a link to the full one, and CHROME_PATH,
// CHROME_BIN and PUPPETEER_EXECUTABLE_PATH preset to /usr/bin/google-chrome, a
// script that runs that link. repo-prep's wrapper for the shell goes in HOME.
const SHELL = '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'
const FULL = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
const WRAPPER = '/root/.cache/repo-prep/chrome-headless-shell'
const PRESET = '/usr/bin/google-chrome'
const IMAGE: Omit<Host, 'repos'> = {
  root: '/home/user',
  entries: [],
  env: { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers', HOME: '/root', CHROME_PATH: PRESET, CHROME_BIN: PRESET, PUPPETEER_EXECUTABLE_PATH: PRESET },
  browsers: ['chromium-1243', 'chromium_headless_shell-1243', 'ffmpeg-1011'],
  files: ['/opt/pw-browsers', FULL, SHELL, '/usr/bin/google-chrome'],
  links: { '/opt/pw-browsers/chromium': FULL },
  texts: { '/usr/bin/google-chrome': '#!/bin/sh\n[ "$(id -u)" -ne 0 ] || set -- --no-sandbox "$@"\nexec /opt/pw-browsers/chromium "$@"\n' },
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

  test('prefers the headless shell when Playwright ships one', async ($, on) => {
    const abyss = repo({ origin: 'https://github.com/joek670/abyss', hooks: '', remote: ['main'], local: { main: { ahead: 0, behind: 0 } } })
    const shell = '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'
    const { envSets } = fakeHost(on, {
      ...CLOUD,
      entries: [{ name: 'abyss', kind: 'dir' }],
      browsers: ['chromium-1243', 'chromium_headless_shell-1243', 'ffmpeg-1011'],
      files: ['/home/user/abyss/.git', '/opt/pw-browsers', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', shell],
      repos: { '/home/user/abyss': abyss },
    })
    await $.session.start(START)
    expect(envSets.CHROME_PATH).toBe(shell)
  })

  // Where else Playwright keeps the shell: Linux arm64 in 1.63, every Linux
  // build in 1.49. A plain `-linux` folder is looked for too.
  for (const shell of [
    '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell',
    '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux/chrome-headless-shell',
    '/opt/pw-browsers/chromium_headless_shell-1148/chrome-linux/headless_shell',
  ]) {
    test(`finds the headless shell at ${shell.split('/').slice(3).join('/')}`, async ($, on) => {
      const { envSets } = fakeHost(on, {
        ...CLOUD,
        entries: [],
        repos: {},
        browsers: ['chromium-1243', shell.split('/')[3] ?? ''],
        files: ['/opt/pw-browsers', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', shell],
      })
      await $.session.start(START)
      expect(envSets.CHROME_PATH).toBe(shell)
    })
  }

  test("replaces each browser variable that runs Playwright's full Chromium through a script", async ($, on) => {
    const { envSets, logs, writes, chmods } = fakeHost(on, { ...IMAGE, repos: {} })
    await $.session.start(START)
    expect(envSets).toEqual({ CHROME_PATH: WRAPPER, CHROME_BIN: WRAPPER, PUPPETEER_EXECUTABLE_PATH: WRAPPER })
    expect(writes[WRAPPER]).toBe(
      "#!/bin/sh\n# Written by the repo-prep mod: Playwright's headless shell, with --no-sandbox as root.\n" +
        `[ "$(id -u)" -ne 0 ] || set -- --no-sandbox "$@"\nexec '${SHELL}' "$@"\n`,
    )
    expect(chmods).toEqual([`755 ${WRAPPER}`])
    const all = 'CHROME_PATH, CHROME_BIN and PUPPETEER_EXECUTABLE_PATH'
    expect(logs).toEqual([
      `repo-prep: set ${all} to ${WRAPPER}, which runs ${SHELL} with --no-sandbox as root, in place of ${PRESET}, which runs Playwright's full Chromium`,
    ])
    const { sections } = await $.prompt.compose(COMPOSE)
    const note = sections.find(s => s.id === 'repo-prep:report')?.text
    expect(note).toContain(`${all} are set to ${WRAPPER} (repo-prep's wrapper for ${SHELL}, adding --no-sandbox as root) for the commands you run`)
    expect(note).toContain(`They were ${PRESET}, which runs Playwright's full Chromium and hangs on --dump-dom.`)
  })

  for (const chromePath of [FULL, '/opt/pw-browsers/chromium']) {
    test(`replaces a CHROME_PATH of ${chromePath}, the full Chromium or a link to it`, async ($, on) => {
      const { envSets } = fakeHost(on, { ...IMAGE, env: { ...IMAGE.env, CHROME_PATH: chromePath }, repos: {} })
      await $.session.start(START)
      expect(envSets.CHROME_PATH).toBe(WRAPPER)
    })
  }

  test('replaces CHROME_BIN alone when only it runs the full Chromium, and fills in no other variable', async ($, on) => {
    const env = { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers', HOME: '/root', CHROME_PATH: '/nowhere/chrome', CHROME_BIN: PRESET }
    const { envSets } = fakeHost(on, { ...IMAGE, env, repos: {} })
    await $.session.start(START)
    expect(envSets).toEqual({ CHROME_BIN: WRAPPER })
  })

  test('sees a script that names the browser through $PLAYWRIGHT_BROWSERS_PATH', async ($, on) => {
    const { envSets } = fakeHost(on, { ...IMAGE, texts: { [PRESET]: '#!/bin/sh\nexec "$PLAYWRIGHT_BROWSERS_PATH/chromium" "$@"\n' }, repos: {} })
    await $.session.start(START)
    expect(envSets.CHROME_PATH).toBe(WRAPPER)
  })

  // Without a HOME to write it in, or when chmod fails, the bare shell goes in.
  const UNMADE: [string, Partial<Host>][] = [
    ['there is no HOME', { env: { ...IMAGE.env, HOME: undefined } }],
    ['chmod fails', { chmodFails: true }],
  ]
  for (const [why, over] of UNMADE) {
    test(`puts the bare shell in place when its wrapper cannot be made: ${why}`, async ($, on) => {
      const { envSets, logs } = fakeHost(on, { ...IMAGE, ...over, repos: {} })
      await $.session.start(START)
      expect(envSets.CHROME_PATH).toBe(SHELL)
      expect(logs[0]).toContain(`to ${SHELL}, in place of ${PRESET}`)
    })
  }

  // Someone's own browser stays, a binary or a launcher script that runs
  // something else (Google Chrome's own is one), and so do the shell itself
  // and a path that leads nowhere.
  const only = (chromePath: string) => ({ PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers', HOME: '/root', CHROME_PATH: chromePath })
  const KEPT: [string, Partial<Host>][] = [
    ['a browser binary', { texts: {} }],
    ['a script that runs another browser', { texts: { [PRESET]: '#!/bin/bash\nHERE="/opt/google/chrome"\nexec -a "$0" "$HERE/chrome" "$@"\n' } }],
    ['the headless shell already', { env: only(SHELL) }],
    ['a path that leads nowhere', { env: only('/nowhere/chrome') }],
  ]
  for (const [what, over] of KEPT) {
    test(`leaves a CHROME_PATH that is ${what}`, async ($, on) => {
      const { envSets, logs } = fakeHost(on, { ...IMAGE, ...over, repos: {} })
      await $.session.start(START)
      expect(envSets).toEqual({})
      expect(logs).toEqual([])
    })
  }

  test('keeps a full Chromium CHROME_PATH when there is no shell to put in its place', async ($, on) => {
    const files = (IMAGE.files ?? []).filter(file => file !== SHELL)
    const { envSets } = fakeHost(on, { ...IMAGE, browsers: ['chromium-1243', 'ffmpeg-1011'], files, repos: {} })
    await $.session.start(START)
    expect(envSets).toEqual({})
  })

  test('sees through a browsers folder that is itself a link', async ($, on) => {
    const shell = '/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'
    const { envSets, writes } = fakeHost(on, {
      ...IMAGE,
      env: { ...IMAGE.env, PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright' },
      files: [...(IMAGE.files ?? []), '/ms-playwright', shell],
      links: { ...IMAGE.links, '/ms-playwright': '/opt/pw-browsers' },
      repos: {},
    })
    await $.session.start(START)
    expect(envSets.CHROME_PATH).toBe(WRAPPER)
    expect(writes[WRAPPER]).toContain(`exec '${shell}' "$@"`)
  })

  test('says so when the engine refuses the change, and tells the model which browser to use', async ($, on) => {
    const { envSets, logs } = fakeHost(on, { ...IMAGE, denyEnv: 'held by your organization', repos: {} })
    await $.session.start(START)
    expect(envSets).toEqual({})
    const all = 'CHROME_PATH, CHROME_BIN and PUPPETEER_EXECUTABLE_PATH'
    expect(logs).toEqual([`repo-prep: could not point ${all} at ${WRAPPER}, which runs ${SHELL} with --no-sandbox as root: held by your organization`])
    const { sections } = await $.prompt.compose(COMPOSE)
    const note = sections.find(s => s.id === 'repo-prep:report')?.text
    expect(note).toContain(`${all} are ${PRESET}, which runs Playwright's full Chromium and hangs on --dump-dom; repo-prep could not change them`)
    expect(note).toContain(`Run browser test suites with ${all} set to ${WRAPPER} (repo-prep's wrapper for ${SHELL}, adding --no-sandbox as root).`)
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
