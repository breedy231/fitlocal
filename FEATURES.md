# FitLocal Feature Roadmap

Feature ideas sourced from competitive research (Fitbod, Apple Fitness, Peloton, Strong, Hevy, RP Hypertrophy, JEFIT, Gymshark). Prioritized by impact and architectural fit.

---

## Tier 1: High Impact (in progress)

- [x] **Post-workout effort rating** — 1-10 discrete buttons on summary screen, stored as `effort_rating` on workouts table
- [x] **Pre-fill sets with last performance** — show "Last: 185 lbs x 8" per set, pre-fill inputs
- [x] **PR detection + celebration** — confetti + haptic when logging a new max weight
- [ ] **Non-blocking rest timer** — floating bottom bar, push notifications, per-exercise config
- [ ] **Training load indicator** — 28-day EWMA range bar on home page (well below → well above)
- [ ] **Weekly training rings** — SVG rings on home page (volume, consistency, recovery)

---

## Tier 2: Medium Impact

### Strength standards / benchmarks
Show where lifts fall relative to bodyweight-adjusted standards: Beginner / Novice / Intermediate / Advanced / Elite. Data from Symmetric Strength or similar open datasets. Per-exercise in detail view. Most-requested missing feature in Strong.

### Three-layer progressive disclosure (Apple pattern)
Apply glanceable → summary → detail pattern across all pages. Home: rings + arrows. Tap: weekly chart. Tap further: full data. Audit each page for this.

### Workout calendar heatmap
Month-view on history page. Each day color-coded by whether you trained and what muscle groups. GitHub contribution graph style. Single SVG component.

### Body part volume heatmap
Weekly view showing volume (sets or tonnage) per muscle group as color-coded grid or body silhouette. Complements the recovery grid — volume input vs recovery output.

### Estimated 1RM per exercise
Epley formula: `1RM = weight * (1 + reps/30)`. Show on exercise detail page and reports. Track over time as line chart. One-liner calculation on existing data.

### Monthly personal challenges (Apple pattern)
Auto-generated monthly challenge calibrated to 4-week average + 10-15%. Examples: "Complete 18 workouts in April" or "Log 400 sets this month." Unique badge on completion. Target is personalized.

---

## Tier 3: Nice-to-Have

### Superset visual bracket + auto-cycling (Strong pattern)
Visual bracket connecting paired exercises in logging. Auto-scroll to partner after set completion. Rest timer only after full superset round.

### Workout share card generation
Post-workout: generate clean dark-themed image card with key lifts, volume, duration, PRs. Canvas/SVG client-side rendering. Save to photos or share.

### Exercise demonstration links
Link exercises to open-source animated GIFs or videos (ExRx.net, wger). "How to" button during logging. Valuable for unfamiliar program exercises.

### Deload auto-scheduling (RP pattern)
After 4-6 weeks of increasing training load (from EWMA), suggest a deload: "You've been pushing hard for 5 weeks. Consider reducing volume 40%." Notification/suggestion, not forced.

### Program/routine export/import (JSON)
Export programs as JSON file, import from file. Share via AirDrop. Unix principle: data as portable, human-readable files.

### Achievements / badge collection
Milestones: 100/250/500/1000 workouts, per-exercise milestones (100 bench sessions), streak badges (4/8/16/52 weeks), PR badges. Trophy case grid. Empty slots drive collection.

### Social features (lowest priority)
Local household feed if multiple users share an instance. Simple workout sharing. Not a priority but architecturally easy with a user concept.

---

## Anti-patterns (don't build)

- **AI form analysis** — too early, unreliable, requires camera
- **Global leaderboards** — Apple avoids these; they discourage more than motivate
- **Daily streaks** (vs weekly) — punish rest days, bad for strength training
- **Single readiness score** — showing components is better than a black-box number
- **Paid routine marketplace** — doesn't fit self-hosted philosophy
- **Video-guided workouts** — massive content investment, not our differentiator

---

## Research Sources

- **Strong**: Gold-standard set logging UX, non-blocking rest timer, plate calculator, superset brackets
- **Apple Fitness**: Activity rings psychology, progressive disclosure (3-layer), training load (watchOS 11), weekly framing, personal monthly challenges
- **Peloton**: Weekly streaks, PR celebration with confetti, post-workout share cards, milestone badges
- **Hevy**: Body part volume heatmap, workout calendar, social feed, routine sharing
- **RP Hypertrophy**: RPE feedback loop, auto-regulated volume, mesocycle periodization, deload management
- **JEFIT**: Animated exercise demonstrations, form cue pop-ups during rest
- **Gymshark**: Exercise swap with muscle-equivalent suggestions
