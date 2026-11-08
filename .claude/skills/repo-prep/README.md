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
- **Browser tests can't find a Chrome that works in a cloud session.** Where
  `PLAYWRIGHT_BROWSERS_PATH` names a folder with Playwright's Chromium
  (`/opt/pw-browsers` in a cloud session), it points `CHROME_PATH` at the
  newest headless shell (`chromium_headless_shell-N/.../chrome-headless-shell`,
  or an older Playwright's `.../chrome-linux/headless_shell`) for every
  command the session runs. In build 1243, full Chromium's `--headless=new
  --dump-dom` hangs until killed when it gets a fresh `--user-data-dir`, as
  test runners give it, while the shell answers in under a second.

  It does that when `CHROME_PATH` is unset, and in place of any of
  `CHROME_PATH`, `CHROME_BIN` (Karma) and `PUPPETEER_EXECUTABLE_PATH`
  (Puppeteer) that runs Playwright's full Chromium: that binary, a link to
  it, or a script of up to 64 KiB that names either, by its path, through
  `$PLAYWRIGHT_BROWSERS_PATH`, or beside the script (`$(dirname "$0")`).
  The cloud image seen in November 2026 sets all three to
  `/usr/bin/google-chrome`, a script that runs
  `exec /opt/pw-browsers/chromium "$@"`, a link to the full Chromium. In
  place of such a value it puts `~/.cache/repo-prep/chrome-headless-shell`,
  a script of its own that runs the shell and, like the image's, adds
  `--no-sandbox` as root, where the shell won't start without it. If it
  can't write that script, the bare shell goes in. Any other value, such as
  a Chrome of your own, stays as it is, and `CHROME_BIN` and
  `PUPPETEER_EXECUTABLE_PATH` are never filled in. Without a shell, an
  unset `CHROME_PATH` gets the newest `chromium-N/chrome-linux*/chrome`, and
  a set one stays. `joek670/abyss`'s browser suites need it.

It says what it did in one transcript line, and tells the model in a short
system-prompt section only what changes how it works (hooks are on, compare
against `origin/<b>`, or which `CHROME_PATH` its commands get). Where the
engine refuses to change `CHROME_PATH` (an organization's settings can hold
it), the line says so, and the model is told which `CHROME_PATH` to run
browser tests with. `/repo-prep` runs it again and replies with what it did.

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
(git, and `chmod` on its wrapper), `$.fs.list` and `$.fs.exists`,
`$.fs.stat` and `$.fs.read` (where a browser variable leads, and a script's
text up to 64 KiB), `$.fs.write` (its wrapper), `$.env.get` (`CHROME_PATH`,
`CHROME_BIN`, `PUPPETEER_EXECUTABLE_PATH`, `PLAYWRIGHT_BROWSERS_PATH`,
`HOME`) and `$.env.set` (the first three), `$.session.root`,
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
