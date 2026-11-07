import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

// Each test stands a fake GitHub MCP server beneath the plugin, then makes a
// merge call the way the model does and reads what reached GitHub.

type File = { filename: string; status: string; previous_filename?: string; patch?: string }

// How a page of files too large for one result comes back, as the engine
// hands it over: its notice with the whole page saved to a file (`saved`), the
// notice naming a file that cannot be read (`unreadable`), the notice with no
// file at all (`unsaved`), or naming a file outside a tool-results folder
// (`elsewhere`).
type Oversize = 'saved' | 'unreadable' | 'unsaved' | 'elsewhere'

type Fake = {
  config?: object | string
  files?: File[]
  checks?: { name: string; status: string; conclusion: string | null }[]
  state?: string
  failFiles?: boolean
  filesText?: string
  oversize?: (perPage: number) => Oversize | undefined
  savedDir?: string
  configForm?: 'resource' | 'blob' | 'rendered' | 'rendered-joined' | 'missing'
}

const UNIX_SAVED = '/root/.claude/projects/-home-user/s1/tool-results'

// The engine's notice, as it reads for a result too large for one result.
const notice = (chars: number, path?: string) =>
  `Error: result (${chars.toLocaleString('en-US')} characters across 1 line) exceeds maximum allowed tokens.` +
  (path === undefined ? '' : ` Output has been saved to ${path}.\nFormat: Plain text\n- For targeted searches (find a string): use grep on the file directly.`)

const HEAD = 'abc1234def5678'
const MERGE = { tool: 'mcp__github__merge_pull_request', owner: 'joek670', repo: 'abyss', pullNumber: 7 } as const

type Block = { type: string; text?: string; resource?: { uri: string; mimeType: string; text?: string; blob?: string } }

// What an mcp.call hook answers: the MCP result, under `value`.
const reply = (content: Block[], isError = false) => ({ value: { content, isError } })
const text = (value: unknown) => reply([{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }])

function fakeGithub(on: On, fake: Fake, server = 'github') {
  const merged: Record<string, unknown>[] = []
  const servers = new Set<string>()
  const pageSizes: number[] = []
  const reads: string[] = []
  const savedCopies = new Map<string, string>()
  on('fs.read', async ($, e) => {
    reads.push(e.path)
    // A Windows path is not absolute on the Linux test host, which resolves it
    // against the working directory first: match on the path's end.
    const copy = savedCopies.get(e.path) ?? [...savedCopies].find(([saved]) => e.path.endsWith(saved))?.[1]
    if (copy === undefined) throw new Error(`ENOENT: no such file, open '${e.path}'`)
    return { value: copy }
  })
  on('mcp.call', async ($, e) => {
    servers.add(e.server)
    const { method, page = 1 } = e.args
    if (e.tool === 'get_file_contents') {
      if (fake.config === undefined) {
        return reply(
          [{ type: 'text', text: 'Failed to get file contents. The path does not point to a file or directory, or the file does not exist in the repository.' }],
          true,
        )
      }
      const body = typeof fake.config === 'string' ? fake.config : JSON.stringify(fake.config)
      const status = 'successfully downloaded text file (SHA: 1234)'
      const uri = 'repo://joek670/abyss/contents/.claude/ship-gate.json'
      const rendered = `[Resource from github at ${uri}] ${body}`
      switch (fake.configForm) {
        case 'blob':
          return reply([{ type: 'text', text: status }, { type: 'resource', resource: { uri, mimeType: 'text/plain', blob: btoa(body) } }])
        case 'rendered':
          return reply([{ type: 'text', text: status }, { type: 'text', text: rendered }])
        case 'rendered-joined':
          return reply([{ type: 'text', text: `${status}\n${rendered}` }])
        case 'missing':
          return reply([{ type: 'text', text: status }])
        default:
          return reply([{ type: 'text', text: status }, { type: 'resource', resource: { uri, mimeType: 'text/plain', text: body } }])
      }
    }
    if (method === 'get') return text({ state: fake.state ?? 'open', base: { ref: 'main' }, head: { sha: HEAD } })
    if (method === 'get_files') {
      if (fake.failFiles) return reply([{ type: 'text', text: 'API rate limit exceeded' }], true)
      if (fake.filesText !== undefined) return text(fake.filesText)
      const perPage = Number(e.args.perPage ?? 30)
      pageSizes.push(perPage)
      const start = (Number(page) - 1) * perPage
      const body = JSON.stringify((fake.files ?? []).slice(start, start + perPage))
      const mode = fake.oversize?.(perPage)
      if (mode === undefined) return text(body)
      const dir = fake.savedDir ?? UNIX_SAVED
      const sep = dir.includes('\\') ? '\\' : '/'
      const path = mode === 'elsewhere' ? '/etc/passwd' : `${dir}${sep}mcp-github-pull_request_read-${pageSizes.length}.txt`
      if (mode === 'saved') savedCopies.set(path, body)
      return text(notice(body.length, mode === 'unsaved' ? undefined : path))
    }
    if (method === 'get_check_runs') {
      const runs = fake.checks ?? []
      return text({ total_count: runs.length, check_runs: runs })
    }
    throw new Error(`the fake GitHub has no ${e.tool} ${String(method)}`)
  })
  on('tool.call', { tool: `mcp__${server}__merge_pull_request` }, async ($, e) => {
    merged.push({ ...e })
    return { result: [{ type: 'text', text: 'merged' }] }
  })
  on('tool.call', { tool: `mcp__${server}__enable_pr_auto_merge` }, async ($, e) => {
    merged.push({ ...e })
    return { result: [{ type: 'text', text: 'auto-merge on' }] }
  })
  return { merged, servers, pageSizes, reads }
}

// The reason a refused call carries, however the engine hands it back.
function refusedWith(answer: unknown): string | undefined {
  const a = answer as { deny?: string; isError?: boolean; text?: string }
  if (typeof a.deny === 'string') return a.deny
  return a.isError === true ? a.text : undefined
}

const ABYSS = { holdDeletions: true, holdPaths: ['.github/', 'Dockerfile'], requireGreenChecks: true }
const GREEN = [{ name: 'check', status: 'completed', conclusion: 'success' }]
const QDRANT = { name: 'Qdrant API key', pattern: "QDRANT_KEY *= *'[^_][^']{10,}'" }

// A made-up key, and the workflow line that would carry it. Both are built
// in parts so that no line of this file looks like a key to ai-tools'
// .githooks/pre-commit, or to ship-gate itself.
const FAKE_KEY = ['q9Zx81', 'LmnB7t', 'Yp2w'].join('')
const keyLine = (value: string) => `const ${'QDRANT'}_KEY = '${value}';`

describe('without .claude/ship-gate.json on the base branch', () => {
  test('a merge goes through untouched', async ($, on) => {
    const { merged } = fakeGithub(on, { files: [{ filename: 'Dockerfile', status: 'removed' }] })
    const answer = await $.tool.call({ ...MERGE })
    expect(refusedWith(answer)).toBeUndefined()
    expect(merged).toHaveLength(1)
    expect(merged[0]?.expectedHeadSha).toBeUndefined()
  })

  test('auto-merge goes through untouched', async ($, on) => {
    const { merged } = fakeGithub(on, {})
    const answer = await $.tool.call({ ...MERGE, tool: 'mcp__github__enable_pr_auto_merge' })
    expect(refusedWith(answer)).toBeUndefined()
    expect(merged).toHaveLength(1)
  })
})

describe('with rules on the base branch', () => {
  test('a clean pull request merges, pinned to the head that was checked', async ($, on) => {
    const { merged } = fakeGithub(on, {
      config: ABYSS,
      files: [{ filename: 'public/app.js', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }],
      checks: GREEN,
    })
    const answer = await $.tool.call({ ...MERGE, merge_method: 'merge' })
    expect(refusedWith(answer)).toBeUndefined()
    expect(merged).toHaveLength(1)
    expect(merged[0]?.expectedHeadSha).toBe(HEAD)
    expect(merged[0]?.merge_method).toBe('merge')
  })

  test('a deleted file holds the merge', async ($, on) => {
    const { merged } = fakeGithub(on, { config: ABYSS, files: [{ filename: 'server/old.mjs', status: 'removed' }], checks: GREEN })
    const reason = refusedWith(await $.tool.call({ ...MERGE }))
    expect(reason).toContain('deletes server/old.mjs')
    expect(reason).toContain('Leave the pull request open')
    expect(merged).toHaveLength(0)
  })

  test('a held folder, a held file and a rename out of a held folder each hold it', async ($, on) => {
    const { merged } = fakeGithub(on, {
      config: ABYSS,
      files: [
        { filename: '.github/workflows/check.yml', status: 'modified', patch: '+x' },
        { filename: 'Dockerfile', status: 'modified', patch: '+x' },
        { filename: 'docs/old-ci.yml', previous_filename: '.github/old.yml', status: 'renamed' },
      ],
      checks: GREEN,
    })
    const reason = refusedWith(await $.tool.call({ ...MERGE }))
    expect(reason).toContain('touches .github/workflows/check.yml (held: .github/)')
    expect(reason).toContain('touches Dockerfile (held: Dockerfile)')
    expect(reason).toContain('touches .github/old.yml (held: .github/)')
    expect(merged).toHaveLength(0)
  })

  test('a rule names a path from the root, not a file of the same name elsewhere', async ($, on) => {
    const { merged } = fakeGithub(on, {
      config: ABYSS,
      files: [
        { filename: 'docs/Dockerfile', status: 'modified', patch: '+x' },
        { filename: 'docs/.github/notes.md', status: 'added', patch: '+x' },
      ],
      checks: GREEN,
    })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toBeUndefined()
    expect(merged).toHaveLength(1)
  })

  test("the gate's own rules and code are always held", async ($, on) => {
    const { merged } = fakeGithub(on, {
      config: {},
      files: [
        { filename: '.claude/ship-gate.json', status: 'modified', patch: '+x' },
        { filename: '.claude/skills/ship-gate/hooks/register.ts', status: 'modified', patch: '+x' },
      ],
    })
    const reason = refusedWith(await $.tool.call({ ...MERGE }))
    expect(reason).toContain('touches .claude/ship-gate.json')
    expect(reason).toContain('touches .claude/skills/ship-gate/hooks/register.ts')
    expect(merged).toHaveLength(0)
  })

  test('a secret-looking added line holds it, and the refusal never repeats the line', async ($, on) => {
    const { merged } = fakeGithub(on, {
      config: { holdAddedLines: [QDRANT] },
      files: [{ filename: 'workflows/rag.json', status: 'modified', patch: `@@ -1 +1 @@\n-${keyLine('__QDRANT_API_KEY__')}\n+${keyLine(FAKE_KEY)}` }],
    })
    const reason = refusedWith(await $.tool.call({ ...MERGE }))
    expect(reason).toContain('adds a line in workflows/rag.json that looks like a Qdrant API key')
    expect(reason).not.toContain(FAKE_KEY)
    expect(merged).toHaveLength(0)
  })

  test('the placeholder, and a removed key, do not hold it', async ($, on) => {
    const { merged } = fakeGithub(on, {
      config: { holdAddedLines: [QDRANT] },
      files: [
        { filename: 'workflows/rag.json', status: 'modified', patch: `@@ -1 +1 @@\n-${keyLine(FAKE_KEY)}\n+${keyLine('__QDRANT_API_KEY__')}` },
      ],
    })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toBeUndefined()
    expect(merged).toHaveLength(1)
  })

  test('a changed file whose diff GitHub hides holds it when secrets are checked', async ($, on) => {
    const { merged } = fakeGithub(on, {
      config: { holdAddedLines: [QDRANT] },
      files: [{ filename: 'docs/diagram.png', status: 'added' }],
    })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toContain('docs/diagram.png, whose diff GitHub does not show')
    expect(merged).toHaveLength(0)
  })

  test('the second page of files is read', async ($, on) => {
    const files: File[] = Array.from({ length: 100 }, (_, i) => ({ filename: `public/f${i}.js`, status: 'modified', patch: '+x' }))
    files.push({ filename: 'public/gone.js', status: 'removed' })
    const { merged } = fakeGithub(on, { config: ABYSS, files, checks: GREEN })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toContain('deletes public/gone.js')
    expect(merged).toHaveLength(0)
  })

  test('auto-merge is held, since it would merge commits pushed later', async ($, on) => {
    const { merged } = fakeGithub(on, { config: ABYSS, checks: GREEN })
    expect(refusedWith(await $.tool.call({ ...MERGE, tool: 'mcp__github__enable_pr_auto_merge' }))).toContain('held auto-merge')
    expect(merged).toHaveLength(0)
  })

  test('a merge naming another head is held', async ($, on) => {
    const { merged } = fakeGithub(on, { config: ABYSS, checks: GREEN })
    expect(refusedWith(await $.tool.call({ ...MERGE, expectedHeadSha: 'fffffff' }))).toContain(`its head is ${HEAD}`)
    expect(merged).toHaveLength(0)
  })

  test('a closed pull request is left to GitHub to answer', async ($, on) => {
    const { merged } = fakeGithub(on, { config: ABYSS, state: 'closed', files: [{ filename: 'x', status: 'removed' }] })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toBeUndefined()
    expect(merged).toHaveLength(1)
  })
})

describe('checks, where the rules require them green', () => {
  test('a check still running holds it', async ($, on) => {
    const { merged } = fakeGithub(on, { config: ABYSS, checks: [{ name: 'check', status: 'in_progress', conclusion: null }] })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toContain('has check "check" still in progress')
    expect(merged).toHaveLength(0)
  })

  test('a failed check holds it', async ($, on) => {
    const { merged } = fakeGithub(on, { config: ABYSS, checks: [{ name: 'check', status: 'completed', conclusion: 'failure' }] })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toContain('has check "check" ending failure')
    expect(merged).toHaveLength(0)
  })

  test('no checks at all holds it', async ($, on) => {
    const { merged } = fakeGithub(on, { config: ABYSS, checks: [] })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toContain('has no checks reported on abc1234 yet')
    expect(merged).toHaveLength(0)
  })

  test('checks are not asked for where the rules do not require them', async ($, on) => {
    const { merged } = fakeGithub(on, { config: { holdDeletions: true }, checks: [] })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toBeUndefined()
    expect(merged).toHaveLength(1)
  })
})

describe('when the gate cannot check, it holds', () => {
  test('rules that are not JSON', async ($, on) => {
    const { merged } = fakeGithub(on, { config: '{ holdDeletions: true' })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toContain('could not check this merge')
    expect(merged).toHaveLength(0)
  })

  test('a misspelt rule', async ($, on) => {
    const { merged } = fakeGithub(on, { config: { holdPath: ['.github/'] } })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toContain('unknown key "holdPath"')
    expect(merged).toHaveLength(0)
  })

  test('GitHub failing to list the files', async ($, on) => {
    const { merged } = fakeGithub(on, { config: ABYSS, failFiles: true })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toContain('API rate limit exceeded')
    expect(merged).toHaveLength(0)
  })
})

describe('a file list too large for one result', () => {
  const CLEAN: File[] = [{ filename: 'public/app.js', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }]

  test('is read from the copy the engine saved, and a clean pull request merges', async ($, on) => {
    const { merged, reads } = fakeGithub(on, { config: ABYSS, files: CLEAN, checks: GREEN, oversize: () => 'saved' })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toBeUndefined()
    expect(merged).toHaveLength(1)
    expect(merged[0]?.expectedHeadSha).toBe(HEAD)
    expect(reads).toEqual([`${UNIX_SAVED}/mcp-github-pull_request_read-1.txt`])
  })

  test('is still checked line by line: a secret in the saved copy holds the merge', async ($, on) => {
    const { merged } = fakeGithub(on, {
      config: { holdAddedLines: [QDRANT] },
      files: [{ filename: 'workflows/rag.json', status: 'added', patch: `@@ -0,0 +1 @@\n+${keyLine(FAKE_KEY)}` }],
      oversize: () => 'saved',
    })
    const reason = refusedWith(await $.tool.call({ ...MERGE }))
    expect(reason).toContain('adds a line in workflows/rag.json that looks like a Qdrant API key')
    expect(reason).not.toContain(FAKE_KEY)
    expect(merged).toHaveLength(0)
  })

  test('is found on a Windows path, spaces and all', async ($, on) => {
    const dir = 'C:\\Users\\Joe Kile\\.claude\\projects\\C--work\\s1\\tool-results'
    const { merged, reads } = fakeGithub(on, { config: ABYSS, files: CLEAN, checks: GREEN, oversize: () => 'saved', savedDir: dir })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toBeUndefined()
    expect(merged).toHaveLength(1)
    expect(reads).toHaveLength(1)
    expect(reads[0]?.endsWith(`${dir}\\mcp-github-pull_request_read-1.txt`)).toBe(true)
  })

  test('whose saved copy cannot be read is asked for again in smaller pages', async ($, on) => {
    const files: File[] = Array.from({ length: 11 }, (_, i) => ({ filename: `public/f${i}.js`, status: 'modified', patch: '+x' }))
    files.push({ filename: 'public/gone.js', status: 'removed' })
    const { merged, pageSizes } = fakeGithub(on, {
      config: ABYSS,
      files,
      checks: GREEN,
      oversize: perPage => (perPage > 5 ? 'unreadable' : undefined),
    })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toContain('deletes public/gone.js')
    expect(pageSizes).toEqual([100, 50, 25, 5, 5, 5])
    expect(merged).toHaveLength(0)
  })

  test('that not even one file of fits is held, saying why', async ($, on) => {
    const { merged, pageSizes } = fakeGithub(on, { config: ABYSS, files: CLEAN, checks: GREEN, oversize: () => 'unsaved' })
    const reason = refusedWith(await $.tool.call({ ...MERGE }))
    expect(reason).toContain('could not check this merge')
    expect(reason).toContain('more than one result can carry, and no copy of it was saved')
    expect(pageSizes).toEqual([100, 50, 25, 5, 1])
    expect(merged).toHaveLength(0)
  })

  test('never reads a file outside a tool-results folder', async ($, on) => {
    const { merged, reads } = fakeGithub(on, { config: ABYSS, files: CLEAN, checks: GREEN, oversize: () => 'elsewhere' })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toContain('could not check this merge')
    expect(reads).toEqual([])
    expect(merged).toHaveLength(0)
  })

  test('text that is neither JSON nor the notice still holds, with what GitHub said', async ($, on) => {
    const { merged, reads } = fakeGithub(on, { config: ABYSS, filesText: 'Bad gateway', checks: GREEN })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toContain('could not check this merge')
    expect(reads).toEqual([])
    expect(merged).toHaveLength(0)
  })
})

test('a GitHub server under another name is asked under that name', async ($, on) => {
  const { merged, servers } = fakeGithub(on, { config: ABYSS, files: [{ filename: 'Dockerfile', status: 'removed' }], checks: GREEN }, 'gh_work')
  expect(refusedWith(await $.tool.call({ ...MERGE, tool: 'mcp__gh_work__merge_pull_request' }))).toContain('deletes Dockerfile')
  expect([...servers]).toEqual(['gh_work'])
  expect(merged).toHaveLength(0)
})

describe('however the rules file comes back from GitHub', () => {
  for (const configForm of ['blob', 'rendered', 'rendered-joined'] as const) {
    test(`${configForm}: a clean pull request merges`, async ($, on) => {
      const { merged } = fakeGithub(on, {
        config: ABYSS,
        configForm,
        files: [{ filename: 'public/app.js', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }],
        checks: GREEN,
      })
      expect(refusedWith(await $.tool.call({ ...MERGE }))).toBeUndefined()
      expect(merged).toHaveLength(1)
    })

    test(`${configForm}: a deleted file still holds the merge`, async ($, on) => {
      const { merged } = fakeGithub(on, { config: ABYSS, configForm, files: [{ filename: 'server/old.mjs', status: 'removed' }], checks: GREEN })
      expect(refusedWith(await $.tool.call({ ...MERGE }))).toContain('deletes server/old.mjs')
      expect(merged).toHaveLength(0)
    })
  }

  test('with no rules text at all, the merge is held', async ($, on) => {
    const { merged } = fakeGithub(on, { config: ABYSS, configForm: 'missing', files: [], checks: GREEN })
    expect(refusedWith(await $.tool.call({ ...MERGE }))).toContain('returned no text')
    expect(merged).toHaveLength(0)
  })
})
