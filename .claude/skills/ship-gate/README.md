# ship-gate

A Claude Code mod that holds a pull request merge which this repository's
rules say a person must make. It enforces the "Stop and ask instead of
merging when" list in `CLAUDE.md`, which until now Claude only read.

When Claude calls the GitHub MCP `merge_pull_request` tool, ship-gate reads
`.claude/ship-gate.json` from the pull request's base branch, lists the pull
request's files (and its checks, if the rules ask for them), and either
refuses the merge with the reasons or lets it through pinned to the head
commit it checked (`expectedHeadSha`), so a push in between makes GitHub
refuse the merge. `enable_pr_auto_merge` is refused outright in a repository
with rules, since auto-merge would merge commits pushed after any check.

A refused merge reaches Claude as an error naming each reason, ending
"Leave the pull request open and tell the user what is blocking the merge",
which is what `CLAUDE.md` asks for. The merge then waits for you on GitHub.

## Rules: `.claude/ship-gate.json`

| Key | Holds a pull request that |
| --- | --- |
| `holdDeletions` | deletes a file |
| `holdPaths` | touches a path: `"infra/"` is a folder, `"Dockerfile"` one file, both from the repository root. A rename is checked at both ends |
| `holdAddedLines` | adds a line matching a pattern: `{ "name", "pattern" }`, a JavaScript regular expression. The refusal names the pattern, never the line. A changed file whose diff GitHub won't show (binary, very large) is held too, since it can't be checked |
| `requireGreenChecks` | has a check run on its head that is unfinished or did not pass, or none at all |

`$comment` is ignored. Any other key, a malformed file, or a GitHub error
holds the merge rather than passing it. A repository without the file is
not gated.

Two paths are always held: `.claude/ship-gate.json` and
`.claude/skills/ship-gate/`. The rules are read from the base branch, not
from the pull request, so a pull request can't loosen the gate it is merged
through, and a change to the gate itself always waits for a person.

## Where it runs

A mod only gates the sessions that load it, and that depends on where the
session starts. Mods need Claude Code 2.1.287 or later.

- **A session started at this repository's root.** The folder holds a
  `.claude-plugin/plugin.json`, so it loads as `ship-gate@skills-dir` once
  the folder is trusted. A local session asks for that trust, and `claude -p`
  alone isn't enough. A cloud session with only this repository starts at the
  root of its clone, so it should load it the same way, but nobody has
  watched one do it yet.
- **A session with several repositories doesn't load it from here.** A cloud
  session with several repositories starts above the clones, and Claude Code
  reads `.claude/skills/` plugins only from the folder a session starts in.
  With Claude Code 2.1.296, a session started above both clones loaded no
  `ship-gate`. For those sessions, turn it on for your claude.ai account.
  Add `joek670/ai-tools` as a plugin marketplace on claude.ai and enable
  `ship-gate`. Claude Code syncs account plugins into the sessions you sign
  in to, cloud sessions included, as `ship-gate@synced`.
- **On your own machine, everywhere.**
  `/plugin install ship-gate --marketplace joek670/ai-tools`, at user scope,
  loads it in every local session, whatever folder it starts in.

Where two copies meet, Claude Code loads one and reports the other as not
loaded, so a synced or installed copy and this folder's copy don't double
up. Run `/plugin` in a terminal session to see `ship-gate` among the active
mods.

The same copy is committed to `joek670/ai-tools` and `joek670/abyss`. Change
both together. `joek670/ai-tools` lists it in `.claude-plugin/marketplace.json`.

## What it doesn't cover

- Merges that don't go through the GitHub MCP tools: `gh pr merge`, the
  GitHub web page, or a direct push to the base branch.
- Files written straight to the base branch with `push_files` or
  `create_or_update_file`.
- Secrets that don't match a listed pattern. The patterns are a backstop for
  the repository's own checks, not a scanner.

## Develop

```sh
claude plugin validate .claude/skills/ship-gate
claude plugin test .claude/skills/ship-gate
```

The tests stand a fake GitHub MCP server beneath the mod and make merge
calls the way the model does.
