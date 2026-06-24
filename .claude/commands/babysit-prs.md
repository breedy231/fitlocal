Babysit open pull requests: poll their CI state, nudge stuck checks, and squash-merge the green ones (confirm-first). Automates the manual poll-CI-and-merge dance for agent PRs.

If invoked with `--dry-run`, do everything below **except** pushing empty commits and merging — just produce the report and state what *would* happen. This is report-only mode.

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
- **Never deploy.** Merging ≠ shipping — deploy stays a separate manual call (`/project:deploy`). This command never builds, restarts, or deploys anything.
- **Idempotent.** Safe to run repeatedly. A nudged PR with checks now running falls into "pending" next pass; an already-merged PR drops off the open list; re-running on a green PR just re-proposes it (no merge without confirmation).
- **`--dry-run` is report-only** — no empty commits, no merges, no branch deletions.

## Running it on a cadence

- Attended, in-session: `/loop /project:babysit-prs` (self-paced, roughly 60–270s between passes).
- Unattended: a `/schedule` cloud routine (~20 min cadence) or a one-shot background agent — survives disconnect, unlike an in-session `/loop`.
