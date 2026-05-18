Test the current UI changes using Playwright at iPhone 15 Pro Max viewport (430×932). Follow these steps:

1. **Set viewport**: resize to 430×932 using `mcp__playwright__browser_resize`.

2. **Identify what to test**: look at the current git diff or recent changes to determine which pages/flows are affected. If the user has described specific changes, focus there. If not, check `git diff --name-only HEAD~1` to find changed Svelte files and infer the relevant route.

3. **Check which server is running**: run `ps aux | grep node` — if `dist/server.js` is in the output, production is running on `:3001`. If `src/server.ts` or `tsx`, dev is on `:3001` with no `/api` prefix. **IMPORTANT:** after `npm run build`, the static files in `packages/web/build` are live immediately — no server restart needed for web-only changes.

4. **Navigate and interact**: use `mcp__playwright__browser_navigate` to reach the relevant page. Walk through the affected flow step-by-step — tap buttons, fill inputs, trigger the specific behavior that changed.

5. **Take labelled screenshots**: for each meaningful state, call `mcp__playwright__browser_take_screenshot` with a descriptive filename (e.g. `test-cardio-ui.png`, `test-swap-open.png`). Always read the screenshot back immediately with the Read tool to verify it shows what you expect.

6. **Cover these cases at minimum**:
   - The happy path for the changed feature
   - Any adjacent UI that could have regressed (e.g. if fixing cardio UI, also verify strength UI still looks right)
   - Edge cases mentioned in the issue or PR

7. **Post to PR**: once satisfied, copy screenshots into `.github/test-screenshots/` with a `pr{N}-` prefix, commit them to the branch, push, then add a `gh pr comment` with the raw GitHub image URLs embedded in markdown. Format:
   ```
   ## Playwright screenshots — iPhone 15 Pro Max (430×932)
   ### [Feature name]
   ![description](https://raw.githubusercontent.com/breedy231/fitlocal/{branch}/.github/test-screenshots/{filename})
   ```

8. **Report back**: show the screenshots inline in the conversation and summarise what passed and what (if anything) needs follow-up.

## Notes
- If the page has a warm-up/stretch phase that blocks the workout view, click "Skip to Workout" first.
- Test data: create throwaway workouts via `curl -X POST http://localhost:3001/api/workouts` and clean them up after, or reuse an existing recent workout.
- The production server almost always has the latest build already loaded for static files — no restart needed after `npm run build` on web-only changes.
- If a swap/search sheet shows no suggestions, check whether the exercise has `primaryMuscles` data via `curl http://localhost:3001/api/exercises`.
