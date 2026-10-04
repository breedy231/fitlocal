Test the current UI changes using Playwright at iPhone 15 Pro Max viewport (430×932). Follow these steps:

**Cloud sessions** have no Playwright MCP, no `fitlocal.db` and no `.env`, so steps 1, 3, 4 and 5 run
differently: follow `docs/cloud-sessions.md` (seed a scratchpad DB, start the API directly, drive the global
Playwright from a script at 430×932, keep screenshots in the scratchpad). Chromium there isn't WebKit, so say
which iOS-only behaviour you couldn't check. Post results with `mcp__github__add_issue_comment` (no `gh`).

1. **Set viewport**: resize to 430×932 using `mcp__playwright__browser_resize`.

2. **Identify what to test**: look at the current git diff or recent changes to determine which pages/flows are affected. If the user has described specific changes, focus there. If not, check `git diff --name-only HEAD~1` to find changed Svelte files and infer the relevant route.

3. **Use the scratch DB so test writes don't pollute real data**: this flow logs workouts, weigh-ins, and otherwise mutates data, all of which would hit the real dev `fitlocal.db` if the API runs normally. Run the API in scratch mode instead — `npm run dev:api:scratch` copies the real DB to `/tmp/fitlocal-scratch.db` and serves from that disposable copy (real DB is read-only). Pair it with `npm run dev:web` (or just point the browser at the already-running `dev:web`). **If a normal `npm run dev` API is already up on `:3001`, stop it first** (or launch the scratch API on a different `PORT` and navigate there) so your taps don't write to real data. Only stop a server you started yourself: in a cloud session, other agents may own the one on `:3001`.

   Then check which server is serving: run `ps aux | grep node`. If `dist/server.js` is in the output, a local prod-mode build (`NODE_ENV=production`) is on `:3001` and uses the `/api` prefix. If `src/server.ts` or `tsx`, dev is on `:3001` with no `/api` prefix. (Real production is the Fly.io app; nothing local changes it.) After `npm run build`, a local `dist/server.js` serves the new static files from `packages/web/build` immediately, with no restart needed for web-only changes.

4. **Navigate and interact**: use `mcp__playwright__browser_navigate` to reach the relevant page. Walk through the affected flow step-by-step — tap buttons, fill inputs, trigger the specific behavior that changed.

5. **Take labelled screenshots**: for each meaningful state, call `mcp__playwright__browser_take_screenshot` with a descriptive filename (e.g. `test-cardio-ui.png`, `test-swap-open.png`). Always read the screenshot back immediately with the Read tool to verify it shows what you expect.

6. **Cover these cases at minimum**:
   - The happy path for the changed feature
   - Any adjacent UI that could have regressed (e.g. if fixing cardio UI, also verify strength UI still looks right)
   - Edge cases mentioned in the issue or PR

7. **Post to PR**: add a `gh pr comment` with test results.

   **Text only.** Screenshots aren't committed: they can show real data, and the repo is public. Images can only be embedded by uploading through the GitHub web UI, so post a text-only comment that describes the flow, what was checked, and the outcome. Never paste real weights or workout data into the comment. Format:
   ```
   ## Playwright test results — iPhone 15 Pro Max (430×932)
   ### ✅ [Feature name]
   **Flow tested:** [steps]
   **Result:** [what was observed]
   ```

8. **Report back**: show the screenshots inline in the conversation and summarise what passed and what (if anything) needs follow-up.

## Notes
- If the page has a warm-up/stretch phase that blocks the workout view, click "Skip to Workout" first.
- Test data: with the scratch DB (step 3) you can create throwaway workouts freely via `curl -X POST http://localhost:3001/workouts` (dev has no `/api` prefix) — they live only in `/tmp/fitlocal-scratch.db` and vanish on the next scratch launch, so there's no cleanup and no risk to real data. (If you ever test against the real DB, clean up afterward.)
- A local prod-mode server (`dist/server.js`) picks up a fresh `npm run build` for static files with no restart. Production on Fly only changes on `fly deploy`.
- If a swap/search sheet shows no suggestions, check whether the exercise has `primaryMuscles` data via `curl http://localhost:3001/exercises` (dev has no `/api` prefix).
