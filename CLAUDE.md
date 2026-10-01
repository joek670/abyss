# Claude Code in this repo

## Ship every change without being asked

When a task changes files here, finish the whole loop in the same turn. Don't
stop at "pushed" and wait to be told to open or merge a pull request.

1. Run `npm run check:all` locally first. It covers what CI runs, and there
   is nothing to install.
2. Commit on the session's branch with a clear message, and push it.
3. Open a pull request into `main`, or update the one already open for the
   branch.
4. Wait for the **Checks** workflow on the head commit. Merge only when it
   passes and there are no conflicts. Use a merge commit, matching the
   existing history. Don't poll in a loop: subscribe to the pull request's
   activity and merge when the green result arrives.
5. Move the local checkout to the updated `main`.

A merge to `main` publishes the live site
(<https://joek670.github.io/abyss/>) through `pages.yml`. That is why green
Checks are a hard requirement.

GitHub deletes merged branches by itself (Settings → General → Automatically
delete head branches), so don't delete them by hand. Session pushes can't
delete remote branches anyway.

If the session's branch was already merged, start it again from the latest
`main` before committing. Never stack new work on a merged branch.

## Stop and ask instead of merging when

- Checks fail and the fix isn't clear, or a merge conflict changes the same
  logic on both sides
- the change deletes files, or touches `.github/` or `Dockerfile`
- the user said to leave the pull request open

In those cases, push and open the pull request anyway, then say what is
blocking the merge.
