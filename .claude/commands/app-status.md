Summarize the current state of the FitLocal app. Run these steps:

1. Run `git log --oneline -8` to show recent commits.
2. Run `git status --short` to show any uncommitted changes (ignore fitlocal.db-shm and fitlocal.db-wal — those are normal WAL artifacts).
3. Run `gh pr list --state open` to check for any open pull requests.

Then produce a concise summary covering:
- The last 5–8 commits with a one-line description of what each did
- Any open PRs and their status
- Whether the working tree is clean (ignoring WAL files)
- What was most recently shipped and what might be next

Keep the tone brief and factual. No trailing summaries or filler.
