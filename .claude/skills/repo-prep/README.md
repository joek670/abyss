# repo-prep

A Claude Code mod that readies the git repositories a session starts in,
once, before the first prompt. It fixes three things a fresh clone gets
wrong:

- **Tracked git hooks are off.** A clone never sets `core.hooksPath`, so
  hooks kept in `.githooks/` don't run. In `joek670/ai-tools` that is the
  pre-commit hook that rejects a literal Qdrant key. repo-prep runs
  `git config --local core.hooksPath .githooks` when the repository tracks
  files there, has no `core.hooksPath` of its own or in your global or
  system git config, and its `origin` is a GitHub repository whose owner is
  in `trustHooksFrom` (default `joek670`). A hook runs that repository's
  code on every commit, so another owner's hooks, or a same-named owner on
  another host, stay off.
- **The local default branch is stale.** A diff against a local `master`
  that is behind `origin/master` shows other people's changes as yours.
  repo-prep fast-forwards the local default branch (origin's HEAD, else
  `main`, else `master`) when it is strictly behind, with
  `git fetch . refs/remotes/origin/<b>:refs/heads/<b>`. That moves a branch
  only as a fast forward, and git refuses it for a branch checked out in any
  worktree. A diverged branch is never touched. It uses the remote-tracking
  ref as it stands and fetches nothing.
- **Browser tests can't find Chrome in a cloud session.** Where
  `CHROME_PATH` is unset and `PLAYWRIGHT_BROWSERS_PATH` names a folder with
  Playwright's Chromium (`/opt/pw-browsers` in a cloud session), it sets
  `CHROME_PATH` for every command the session runs. It picks the newest
  headless shell (`chromium_headless_shell-N/.../chrome-headless-shell`, or
  an older Playwright's `.../chrome-linux/headless_shell`) first: in build
  1243, full Chromium's `--headless=new --dump-dom` hangs until killed when
  it gets a fresh `--user-data-dir`, as test runners give it, while the
  shell answers in under a second. Without a shell it falls back to the
  newest `chromium-N/chrome-linux*/chrome`. `joek670/abyss`'s browser
  suites need it.

  It never replaces a `CHROME_PATH` that is already set, and the cloud
  image seen in November 2026 sets one: `/usr/bin/google-chrome`, a wrapper
  that runs full Chromium. There repo-prep leaves `CHROME_PATH` alone, so a
  session has to point it at the shell itself; abyss's `CLAUDE.md` gives
  the command.

It says what it did in one transcript line, and tells the model in a short
system-prompt section only what changes how it works (hooks are on, or
compare against `origin/<b>`). `/repo-prep` runs it again and replies with
what it did.

A session started inside a repository prepares that repository. A session
started above several clones (a cloud session with more than one
repository) prepares each folder directly beneath it that holds `.git`, up
to 20.

## Options

`trustHooksFrom`: comma-separated GitHub owners whose repositories' tracked
hooks repo-prep turns on. Set it with
`/plugin configure repo-prep@ai-tools`, or
`claude plugin install repo-prep@ai-tools --config trustHooksFrom=joek670`.

## What it reaches

`claude plugin validate` lists it as: hooks `session.start`,
`command.run{command=repo-prep}`, `prompt.compose`; calls `$.process.run`
(git only), `$.fs.list` and `$.fs.exists`, `$.env.get` and `$.env.set`
(`CHROME_PATH`, `PLAYWRIGHT_BROWSERS_PATH`), `$.session.root`,
`$.command.register`, `$.ui.log`. No network, no model calls, no tool-call
gates.

## Where it runs

See `docs/claude-code-mods/README.md` in `joek670/ai-tools`: which sessions
load it from this folder, and how to turn it on for the rest. The same copy
is committed to `joek670/ai-tools` and `joek670/abyss`; change both
together.

## Develop

```sh
claude plugin validate .claude/skills/repo-prep
claude plugin test .claude/skills/repo-prep
```

The tests drive it through a fake git and a fake host. It was also run in
a real headless session over real repositories: hooks were turned on for a
trusted GitHub owner (a real commit ran the hook) and left off for another
owner and for a GitLab origin with the same owner name; stale masters were
fast-forwarded with a feature branch checked out; and Bash saw
`CHROME_PATH`.
