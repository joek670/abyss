import type { EngineInterface, McpContentBlock, Register } from 'claude-code'
import {
  CONFIG_PATH,
  type CheckRun,
  type Config,
  isRecord,
  parseConfig,
  type PullRequestFile,
  reasonsFromChecks,
  reasonsFromFiles,
} from './rules.ts'

// ship-gate holds a pull request merge that the repository's own rules say a
// person must make. A repository opts in with .claude/ship-gate.json. The
// gate reads that file from the pull request's base branch at merge time, so
// a pull request cannot loosen the gate it is about to be merged through.
// Without the file, merges pass untouched.

// The GitHub MCP tools that merge a pull request, whatever the server is named.
const MERGE_TOOL = /^mcp__(.+)__(merge_pull_request|enable_pr_auto_merge)$/

// GitHub serves a pull request's files 100 a page and 3000 in all.
const PER_PAGE = 100
const MAX_PAGES = 30

// The refusal lists this many reasons, then counts the rest.
const MAX_LISTED = 8

type PullRequest = { state: string; base: { ref: string }; head: { sha: string } }

type Repo = { server: string; owner: string; repo: string }

const textOf = (blocks: readonly { type: string; text?: string }[]) =>
  blocks.map(b => (b.type === 'text' ? b.text ?? '' : '')).join('')

// GitHub sends a file as an MCP embedded resource beside a one-line status
// text. Claude Code hands that resource to hooks rewritten as a text block,
// "[Resource from <server> at <uri>] <file text>", so both shapes are read;
// the rewritten one only when its URI names the rules file.
const RESOURCE_TEXT = /^\[Resource from .+? at (\S+)\] ([\s\S]*)$/

function configText(blocks: readonly McpContentBlock[]): string | undefined {
  for (const block of blocks) {
    const resource = block.resource
    if (block.type === 'resource' && isRecord(resource) && typeof resource.text === 'string') return resource.text
    const rewritten = block.type === 'text' && typeof block.text === 'string' ? RESOURCE_TEXT.exec(block.text) : null
    if (rewritten?.[1]?.endsWith(`/${CONFIG_PATH}`)) return rewritten[2]
  }
  return undefined
}

async function githubJson($: EngineInterface, at: Repo, tool: string, args: Record<string, unknown>) {
  const result = await $.mcp.call(at.server, tool, { owner: at.owner, repo: at.repo, ...args })
  const text = textOf(result.content)
  if (result.isError) throw new Error(`GitHub ${tool} failed: ${text.slice(0, 200)}`)
  return JSON.parse(text) as unknown
}

// The config on the base branch, or undefined when the repository has none.
async function readConfig($: EngineInterface, at: Repo, base: string): Promise<Config | undefined> {
  const result = await $.mcp.call(at.server, 'get_file_contents', {
    owner: at.owner,
    repo: at.repo,
    path: CONFIG_PATH,
    ref: `refs/heads/${base}`,
  })
  if (result.isError) {
    const why = textOf(result.content)
    if (/does not exist|not found|404/i.test(why)) return undefined
    throw new Error(`could not read ${CONFIG_PATH} on ${base}: ${why.slice(0, 200)}`)
  }
  const text = configText(result.content)
  if (text === undefined) throw new Error(`GitHub returned no text for ${CONFIG_PATH} on ${base}`)
  return parseConfig(text)
}

async function listFiles($: EngineInterface, at: Repo, pullNumber: number) {
  const files: PullRequestFile[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await githubJson($, at, 'pull_request_read', { method: 'get_files', pullNumber, perPage: PER_PAGE, page })
    if (!Array.isArray(batch)) throw new Error('GitHub get_files did not return a list')
    files.push(...(batch as PullRequestFile[]))
    if (batch.length < PER_PAGE) break
  }
  return files
}

async function listCheckRuns($: EngineInterface, at: Repo, pullNumber: number) {
  const runs: CheckRun[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await githubJson($, at, 'pull_request_read', { method: 'get_check_runs', pullNumber, perPage: PER_PAGE, page })
    if (!isRecord(batch) || !Array.isArray(batch.check_runs)) throw new Error('GitHub get_check_runs did not return check_runs')
    runs.push(...(batch.check_runs as CheckRun[]))
    if (batch.check_runs.length < PER_PAGE || runs.length >= Number(batch.total_count)) break
  }
  return runs
}

function refusal(name: string, base: string, reasons: readonly string[]) {
  const listed = reasons.slice(0, MAX_LISTED).map(reason => `- ${reason}`)
  if (reasons.length > MAX_LISTED) listed.push(`- and ${reasons.length - MAX_LISTED} more`)
  return [
    `ship-gate held the merge of ${name}. The rules in ${CONFIG_PATH} on ${base} say a person merges a pull request that:`,
    ...listed,
    'Leave the pull request open and tell the user what is blocking the merge.',
  ].join('\n')
}

export const register: Register = on => {
  on('tool.call', { tool: MERGE_TOOL }, async ($, e, next) => {
    const [, server, action] = MERGE_TOOL.exec(String(e.tool)) ?? []
    const { owner, repo, pullNumber, expectedHeadSha } = e as unknown as Record<string, unknown>
    if (server === undefined || typeof owner !== 'string' || typeof repo !== 'string' || typeof pullNumber !== 'number') {
      throw new Error('the merge call does not name owner, repo and pullNumber')
    }
    const at: Repo = { server, owner, repo }
    const name = `${owner}/${repo}#${pullNumber}`

    const pr = (await githubJson($, at, 'pull_request_read', { method: 'get', pullNumber })) as PullRequest
    // Nothing to protect on a closed pull request: let GitHub answer.
    if (pr.state !== 'open') return next(e)

    const config = await readConfig($, at, pr.base.ref)
    if (config === undefined) return next(e)

    if (action === 'enable_pr_auto_merge') {
      return {
        deny:
          `ship-gate held auto-merge on ${name}: it would merge commits pushed after any check. ` +
          'Wait for the checks, then merge with merge_pull_request, which ship-gate checks.',
      }
    }

    const sha = pr.head.sha
    if (typeof expectedHeadSha === 'string' && expectedHeadSha !== sha) {
      return { deny: `ship-gate held the merge of ${name}: its head is ${sha}, not ${expectedHeadSha}. Re-read the pull request first.` }
    }

    const reasons = reasonsFromFiles(config, await listFiles($, at, pullNumber))
    if (config.requireGreenChecks) reasons.push(...reasonsFromChecks(sha, await listCheckRuns($, at, pullNumber)))
    if (reasons.length > 0) return { deny: refusal(name, pr.base.ref, reasons) }

    // Merge exactly the commit that was checked: GitHub refuses the merge if
    // the head moves in between.
    return next({ ...e, expectedHeadSha: sha } as typeof e)
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : {
          deny:
            `ship-gate could not check this merge (${next.error.message ?? next.error.kind}), so it held it. ` +
            'Leave the pull request open and tell the user what is blocking the merge.',
        },
  )
}
