Summarize the current state of the FitLocal app. Run these steps:

1. Run `git log --oneline -8` to show recent commits.
2. Run `git status --short` to show any uncommitted changes. In a cloud session this only describes the session's own branch; unpushed work on the Mac is invisible.
3. List open pull requests: `gh pr list --state open` on the Mac, or `mcp__github__list_pull_requests` (owner `breedy231`, repo `fitlocal`, state `open`) in a cloud session, which has no `gh`.

Then produce a concise summary covering:
- The last 5–8 commits with a one-line description of what each did
- Any open PRs and their status
- Whether the working tree is clean
- What was most recently shipped and what might be next

Keep the tone brief and factual. No trailing summaries or filler.
