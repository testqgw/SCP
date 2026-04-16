# Model Integrity Audit - 2026-04-16

## Verdict

The current model story is **not a broad false flag**, but the headline accuracy numbers are easy to overread.

- The promoted `67.61%` replay raw and `66.04%` walk-forward raw are real exported results for the current promoted package.
- Those headline numbers are **same-window / full-history centered**, not the best estimate of current recent live performance.
- The recent honest holdouts are materially lower: `57.08%` raw on the last `14d` and `58.95%` raw on the last `30d`.
- The source data does **not** look broadly corrupted. The only hard data-integrity failures found in the `actualValue` source audit were `2` isolated rows out of `8138`.

## Highest-Risk Finding

### 1. Presentation risk is higher than data-corruption risk

The main integrity risk was metric interpretation.

- Before the honest-baseline update, `lib/snapshot/universalSystemSummary.ts` centered the same-window replay framing.
- The shared summary now centers the honest recent holdouts instead: `57.08%` raw on `14d`, `58.95%` raw on `30d`, and `58.27%` raw on the latest walk-forward fold.
- The promoted doc also explicitly warns that the replay lift should be treated as same-window optimization, not as pure honest holdout proof.
- Same-window recent numbers are:
  - `14d`: `58.50%`
  - `30d`: `60.09%`
- Honest retrain recent numbers are:
  - `14d`: `57.08%`
  - `30d`: `58.95%`

That means the displayed recent same-window numbers are inflated by about:

- `+1.42` points on `14d`
- `+1.14` points on `30d`

So the promoted package is **real but optimistic** if someone reads the same-window research metrics as the current live expectation.

## Core Findings

### 2. The promoted model still shows honest lift versus the old baseline

The promoted package does survive a stricter check.

- Honest baseline `14d`: `55.79%`
- Honest promoted `14d`: `57.08%`
- Honest baseline `30d`: `57.38%`
- Honest promoted `30d`: `58.95%`

That is a real gain of:

- `+1.29` on honest `14d`
- `+1.57` on honest `30d`

So this is not a pure replay-only mirage.

### 3. Full-window walk-forward hides a real late-season cooldown

The full walk-forward export averages to `66.04%`, but fold performance decays steadily over time:

- Fold 1 (`2025-12-19` to `2026-01-02`): `70.83%`
- Fold 5 (`2026-02-20` to `2026-03-05`): `65.53%`
- Fold 7 (`2026-03-20` to `2026-04-02`): `60.69%`
- Fold 8 (`2026-04-03` to `2026-04-14`): `58.27%`

So the most recent fold is `7.77` points below the full walk-forward average. The model is not broken, but the late window is clearly weaker than the season average.

### 4. The source data is mostly clean, with only 2 hard anomaly rows

The `player_game_logs` source feeding `actualValue` was audited across `8138` played rows from `2025-10-23` through `2026-04-14`.

Hard anomaly counts:

- `pointsAbove70`: `1`
- `reboundsAbove25`: `0`
- `assistsAbove20`: `1`
- `minutesAbove53`: `0`

Hard anomaly rows:

- Bam Adebayo on `2026-03-10`: `83` points
- Ryan Nembhard on `2026-04-12`: `23` assists

This is narrow enough that it does **not** imply broad poisoning of the projection or accuracy tables, but those rows should not be used as literal box-score examples until corrected or excluded.

### 5. Coverage differences matter when comparing "accuracy"

There are multiple valid metric families in play, but they are not interchangeable:

- Honest current live baseline:
  - `14d`: `55.79%` raw at `70.30%` coverage
  - `30d`: `57.38%` raw at `70.36%` coverage
- Honest promoted priority-headroom:
  - `14d`: `57.08%` raw at `96.36%` coverage
  - `30d`: `58.95%` raw at `96.74%` coverage
- Honest recent-safe mid coverage mode:
  - `14d`: `60.38%` raw at `49.77%` coverage
  - `30d`: `62.04%` raw at `50.21%` coverage

These are all useful, but they answer different product questions:

- full-board replay
- full-board recent holdout
- selective recent-safe pack

Any UI or reporting layer that mixes them without labeling will create false confidence.

## What Looks Safe

- The headline exported numbers match the promoted summary files on disk.
- The promoted branch has honest recent lift, so it is not just a bad replay trick.
- The actual-value source audit found isolated anomalies, not systemic corruption.
- The recent-safe mode is the cleanest honest `60%+` story, but it only covers about half the board.

## Remaining Risks

- Older research docs can still be misread if `67.61%` is treated as "current real hit rate."
- Same-window optimization is still present in the promoted priority-headroom package.
- The latest fold weakness means future live performance may track closer to the high-50s than the mid-60s unless the late-season slump is fixed.
- The two hard source anomalies should be corrected or filtered wherever literal game examples are shown.

## Recommended Guardrails

1. Label every top-line metric as one of:
   - `same-window replay`
   - `rolling walk-forward`
   - `honest recent holdout`
   - `recent-safe selective mode`
2. Show coverage next to every accuracy number.
3. Avoid presenting `67.61%` alone as the "current model accuracy." The honest summary surface should stay centered on `57.08%`, `58.95%`, and `58.27%`.
4. Exclude or patch the two hard-anomaly source rows before using breakout-game examples in reports.

## Bottom Line

There is **no sign of broad data poisoning or a completely fake model story**.

The honest read is:

- full-history promoted package looks strong
- current recent performance is weaker than the headline average
- recent-safe mode is the clean honest way to get back above `60%`, but only on about half the board
- the biggest integrity issue is **metric framing**, not hidden catastrophic data corruption
