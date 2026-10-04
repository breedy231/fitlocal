Babysit open pull requests: poll their CI state, nudge stuck checks, and squash-merge the green ones (confirm-first). Automates the manual poll-CI-and-merge dance for agent PRs.

If invoked with `--dry-run`, do everything below **except** pushing empty commits and merging — just produce the report and state what *would* happen. This is report-only mode.

**Cloud sessions** have no `gh` (installing it doesn't help: the proxy blocks GitHub GraphQL). Use the
GitHub MCP tools and see "Cloud sessions" at the end of this file. The nudge in step 4 does not apply there.

## Steps

1. **List candidate PRs.** Run `gh pr list --state open --base main --json number,title,isDraft,labels` to get every open PR targeting `main`. Only PRs into `main` are in scope — ignore PRs targeting any other base branch.

2. **Fetch full state per PR.** For each, run:
   `gh pr view <n> --json number,title,isDraft,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision,labels,headRefName`
   - `statusCheckRollup` is an array of check runs / commit statuses. Empty array = **no checks ran** (the #53 case). Otherwise each entry has `status` (QUEUED/IN_PROGRESS/COMPLETED) and `conclusion` (SUCCESS/FAILURE/etc.).
   - `mergeable` is `MERGEABLE` / `CONFLICTING` / `UNKNOWN`. `mergeStateStatus` is `CLEAN` / `BLOCKED` / `BEHIND` / `DIRTY` / `UNSTABLE` etc.

3. **Classify and act** per the decision table below. Apply the **first** matching row (top to bottom).

| # | Condition | Action |
|---|---|---|
| 1 | `isDraft` is true, **or** labels include `hold` or `wip` | **Skip.** Report as held; never touch. |
| 2 | `mergeable` is `CONFLICTING` (or `mergeStateStatus` is `DIRTY`) | **Never touch.** Report as conflicted — needs manual rebase/resolve. |
| 3 | `statusCheckRollup` is empty (no checks ever ran) | **Auto-nudge.** Push an empty commit to the PR's head branch to retrigger CI (see step 4), then flag it as nudged. *(Skip the push in `--dry-run`; report it as "would nudge".)* |
| 4 | Any check has `conclusion` FAILURE / CANCELLED / TIMED_OUT / ACTION_REQUIRED | **Never merge.** Surface the failing check name(s) and a link to logs (`gh pr checks <n>`). |
| 5 | Any check is still `QUEUED` / `IN_PROGRESS` (none failed) | **Wait.** Report as pending; it'll be re-checked next pass. |
| 6 | All checks `SUCCESS` **and** `mergeable` is `MERGEABLE` **and** `mergeStateStatus` is `CLEAN` | **Mergeable — propose squash-merge (confirm-first), see step 5.** |
| 7 | Anything else (e.g. `BLOCKED` on required review, `BEHIND`) | **Report only.** Note the blocker (e.g. "needs review", "branch behind base"); do not merge. |

4. **Auto-nudge (row 3).** A PR with zero checks is stuck — the workflow never fired. Push an empty commit to retrigger it:
   ```bash
   git fetch origin <headRefName>
   git checkout <headRefName> && git pull --ff-only
   git commit --allow-empty -m "ci: retrigger checks (#<n>)"
   git push origin HEAD
   git checkout -   # return to the previous branch
   ```
   Flag the PR as nudged in the report; do **not** merge it this pass — let CI run and re-evaluate next time.

5. **Squash-merge (row 6) — confirm first.** This is the locked **confirm-first** decision: never merge autonomously. For each mergeable PR, present it in the report (number, title, that CI is green and there are no conflicts) and **ask the user to confirm** before merging. Only after explicit confirmation, run:
   ```bash
   gh pr merge <n> --squash --delete-branch
   ```
   Squash is the locked merge strategy. If the user confirms a batch, merge each confirmed PR in turn. In `--dry-run`, list these as "ready to merge (would squash-merge on confirm)" and do nothing.

6. **Report.** Produce a concise per-PR summary grouped by outcome:
   - **Ready to merge** (awaiting your confirm): `#n title`
   - **Nudged** (empty commit pushed / would push): `#n title`
   - **Pending CI** (waiting): `#n title`
   - **Failing CI**: `#n title` + the failing check(s)
   - **Conflicts** (manual): `#n title`
   - **Held / skipped** (draft, `hold`/`wip`): `#n title`

   Keep it terse and factual — no filler.

## Guardrails (locked)

- **Confirm-first.** Never merge without explicit user confirmation, even when fully green. Propose, then wait.
- **Never merge on failing or pending CI.** Rows 4 and 5 are hard stops.
- **Never merge drafts or `hold`/`wip`-labeled PRs.** Row 1 is a hard skip.
- **Never touch conflicting PRs.** Surface them for manual resolution.
- **Only PRs into `main`.** Filtered at step 1 via `--base main`.
- **Never deploy.** Merging ≠ shipping — deploy stays a separate manual call (`/deploy`, Mac only). This command never builds, restarts, or deploys anything.
- **Idempotent.** Safe to run repeatedly. A nudged PR with checks now running falls into "pending" next pass; an already-merged PR drops off the open list; re-running on a green PR just re-proposes it (no merge without confirmation).
- **`--dry-run` is report-only** — no empty commits, no merges, no branch deletions.

## Running it on a cadence

- Attended, in-session: `/loop /babysit-prs` (self-paced, roughly 60–270s between passes).
- Unattended: a scheduled cloud Routine (at most hourly) or a one-shot background agent. Both survive a disconnect, unlike an in-session `/loop`. For specific PRs, `subscribe_pr_activity` is event-driven and doesn't need polling.

## Cloud sessions

Map each `gh` step to the GitHub MCP tools (owner `breedy231`, repo `fitlocal`):

| Step | Cloud equivalent |
|---|---|
| 1. list | `mcp__github__list_pull_requests` (state `open`, base `main`). List results have no merge state. |
| 2. state | `mcp__github__pull_request_read` with method `get` for `draft`, `labels`, `head` and `mergeable_state` (lowercase: `clean` / `blocked` / `behind` / `dirty` / `unstable` / `unknown`). Use method `get_check_runs` and method `get_status` for checks, and method `get_reviews` for reviews. |
| decision table | CONFLICTING/DIRTY → `mergeable_state == 'dirty'`. CLEAN → `'clean'`. `'unknown'` → still computing, re-check next pass. "No checks ran" → `get_check_runs` total is 0 **and** `get_status` total is 0. |
| 4. nudge | **Not in cloud.** The session harness forbids empty commits and close/reopen to kick CI, and `git checkout` would move the session off its own branch. If the PR is behind `main`, `mcp__github__update_pull_request_branch` starts a fresh CI run. Otherwise report it as stuck. |
| failing checks | `get_check_runs` gives names, conclusions and links. `mcp__github__get_job_logs` gives log excerpts. |
| 5. merge | `mcp__github__merge_pull_request` with `merge_method: squash`, still confirm-first. There's no delete-branch tool: report the leftover branch, or turn on "Automatically delete head branches" in the repo settings. |
