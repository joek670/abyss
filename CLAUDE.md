# CLAUDE.md

## Shell: the user runs Windows PowerShell

Every command written for the user to run goes in **PowerShell**, not bash.
This holds in every session and every repo, not just this one.

PowerShell, not the bash reflex:

| instead of | write |
| --- | --- |
| `export FOO=bar` | `$env:FOO = "bar"` |
| `FOO=bar cmd` | `$env:FOO = "bar"; cmd` |
| `cmd1 && cmd2` | `cmd1; if ($?) { cmd2 }` |
| `ls -la` | `Get-ChildItem -Force` |
| `cat f`, `grep p f` | `Get-Content f`, `Select-String p f` |
| `rm -rf d` | `Remove-Item -Recurse -Force d` |
| `which x` | `Get-Command x` |
| `python3` | `python` (or `py`) |
| `$(cmd)` | `$(cmd)` — same, but `"$(cmd)"` interpolates differently |
| `~/path`, `/c/path` | `$HOME\path`, `C:\path` |
| single quotes for literals | `'literal'` — no variable expansion, same as bash |

Multi-line: PowerShell continues with a backtick `` ` ``, not `\`. Prefer
one command per line over continuations.

Heredocs do not exist. Use a here-string:

```powershell
@'
content
'@ | Set-Content -Encoding utf8 file.txt
```

Paths are backslashed and case-insensitive. Quote anything containing a
space — `C:\Users\jkile\My Folder` breaks unquoted.

This applies to commands the user runs. Commands run inside a Claude Code
cloud session execute in a Linux container, so those stay POSIX — say which
is which when a message has both.

### Where this bites in this repo

The browser suites (`npm test`, `npm run test:static`) find Chrome through
`CHROME_PATH`. `CHROME_PATH=... npm run check` is bash and sets nothing on
Windows:

```powershell
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run check
```

Quote that path — it contains a space. Without the variable the suites
print `No Chrome or Edge binary found` and exit, so a run that looks like
a pass may simply not have run the 101 browser assertions.

`npm run check` chains with `&&` inside package.json, which npm hands to
its own shell, so those work unchanged — it is only `&&` typed at a
PowerShell prompt that needs `; if ($?) { … }`.
