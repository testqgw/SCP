# Universal Model Handoff

As of: 2026-03-13  
Repo: `c:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas`  
Primary app: `https://compliance-reminder-saas.vercel.app`

## 1. What this system is

This repo powers a live NBA player prop dashboard. The core modeling stack is a "universal side model" that decides `OVER`, `UNDER`, or `NEUTRAL` for eight markets:

- `PTS`
- `REB`
- `AST`
- `THREES`
- `PRA`
- `PA`
- `PR`
- `RA`

The universal model is not the same thing as the projection model.

- The projection model produces the underlying projected stat line and a baseline side.
- The universal model is a side-override layer that looks at projection context, pricing, lineup timing, expected minutes, and player archetype.
- The qualification layer decides whether the universal side is strong enough to trust or whether the app should fall back to the original `finalSide`.

Operationally, this is a portfolio selector, not a "bet every row" model.

## 2. What the user is trying to do

The user is trying to build a live, production-deployed betting dashboard that:

- refreshes with current NBA data
- surfaces the best prop bets to focus on today
- uses a universal side model that is measurably better than the baseline
- shows all qualified bets clearly on the site
- keeps improving model accuracy over time

The user repeatedly pushed for higher accuracy and specifically wanted the universal model improved before trusting it more broadly. The work so far has been aimed at:

- raising overall blended accuracy
- keeping qualified accuracy at or above roughly `70%`
- increasing coverage so the model is useful on the live board
- making sure production data freshness is visible and reliable

Important expectation setting:

- `90%` overall blended accuracy on the full all-markets live portfolio is not a realistic target for this kind of broad model.
- `90%+` can be realistic only on a much smaller, much more selective qualified slice.
- The current optimization philosophy has been: keep `qualifiedAccuracy >= 70%`, then maximize blended accuracy and useful coverage.

## 3. Current live state

### 3.1 Current promoted live winner

Source of truth:

- `exports/universal-live-promotion.json`
- `exports/universal-model-qualification-eval.json`

Current promoted winner:

- label: `hybrid`
- calibrated: `false`
- samples: `76,475`
- raw accuracy: `69.34%`
- qualified accuracy: `70.63%`
- qualified picks: `67,698`
- coverage: `88.52%`
- blended accuracy: `68.31%`

Immediate previous live winner before the latest split and AST features:

- raw accuracy: `67.93%`
- qualified accuracy: `70.26%`
- coverage: `82.36%`
- blended accuracy: `67.16%`

Latest measured gain from the new live winner:

- raw: `+1.41`
- qualified: `+0.37`
- coverage: `+6.16`
- blended: `+1.15`

### 3.2 Current by-market metrics

From `exports/universal-model-qualification-eval.json`:

| Market | Samples | Raw | Qualified | Qualified Picks | Coverage | Blended |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PTS | 13,145 | 67.89% | 68.44% | 11,364 | 86.45% | 65.55% |
| REB | 12,940 | 66.55% | 70.62% | 8,643 | 66.79% | 64.69% |
| AST | 12,780 | 66.81% | 68.18% | 10,849 | 84.89% | 66.10% |
| THREES | 9,240 | 69.56% | 71.72% | 7,582 | 82.06% | 68.73% |
| PRA | 7,146 | 71.86% | 72.94% | 6,618 | 92.61% | 71.47% |
| PA | 7,079 | 72.35% | 74.88% | 5,843 | 82.54% | 70.41% |
| PR | 7,124 | 71.65% | 74.49% | 5,848 | 82.09% | 69.97% |
| RA | 7,021 | 72.44% | 76.66% | 5,222 | 74.38% | 70.43% |

Markets still lagging the pack:

- `AST`
- `PTS`
- `REB`

Markets currently strongest:

- `PRA`
- `RA`
- `PR`
- `PA`

### 3.3 Qualified accuracy definitions

These terms matter and future work should keep using them consistently:

- `rawAccuracy`: universal model side accuracy on all eligible rows before qualification
- `qualifiedAccuracy`: accuracy only on rows where the universal model is allowed to make a non-neutral pick
- `coveragePct`: percent of rows that remain non-neutral after qualification
- `blendedAccuracy`: use universal side when qualified, otherwise fall back to baseline `finalSide`

`blendedAccuracy` is the most important portfolio metric if the product goal is "best live board."

## 4. High-level architecture

### 4.1 Core inference file

Main file:

- `lib/snapshot/liveUniversalSideModels.ts`

Responsibilities:

- defines the universal archetype taxonomy
- classifies each player into an archetype
- loads the live universal model artifact
- optionally loads calibration adjustments
- computes raw universal side decisions
- applies qualification thresholds
- returns the final side used by the app

Important exports:

- `inspectLiveUniversalModelSide(...)`
- `qualifyLiveUniversalModelDecision(...)`
- `evaluateLiveUniversalModelSide(...)`
- `predictLiveUniversalModelSide(...)`
- `DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS`

### 4.2 Stable artifact aliases

File:

- `lib/snapshot/universalArtifactPaths.ts`

Important stable paths:

- live model alias: `exports/universal-archetype-side-models-live.json`
- live calibration alias: `exports/universal-live-calibration.json`
- live labeled rows: `exports/projection-backtest-allplayers-with-rows-live.json`
- live historical lines CSV: `exports/historical-lines/all-players-all-markets-live.csv`

This is important: runtime inference should use the stable alias, not a date-stamped artifact path.

### 4.3 Evaluation and promotion files

Files:

- `scripts/evaluate-universal-model-qualification.ts`
- `scripts/retrain-live-universal-model.ts`
- `exports/universal-live-promotion.json`
- `exports/universal-model-qualification-eval.json`

The promotion script:

- builds candidate artifacts
- evaluates direct and hybrid variants
- evaluates calibrated and uncalibrated variants
- prefers candidates with `qualifiedAccuracy >= 70`
- among eligible candidates, chooses highest blended accuracy
- copies the winner to the stable live alias files

### 4.4 Data freshness and health

Files:

- `lib/snapshot/refresh.ts`
- `app/api/refresh/route.ts`
- `app/api/internal/refresh/delta/route.ts`
- `app/api/internal/refresh/full/route.ts`
- `app/api/health/route.ts`
- `.github/workflows/snapshot-refresh.yml`
- `vercel.json`

The system tracks:

- last refresh run
- last publishable refresh run
- latest `playerGameLog.gameDateEt`
- yesterday and today log counts
- whether the database is up to date through yesterday

Production health response confirmed on `2026-03-13`:

- `status: ok`
- `maxLogDateEt: 2026-03-12`
- `logsForYesterday: 320`
- `upToDateThroughYesterday: true`

## 5. Data flow end-to-end

The universal model is trained from historical labeled rows, not directly from raw box score data.

End-to-end flow:

1. Historical line data is exported.
2. The backtest projection model runs over those lines.
3. The backtest emits row-level records with:
   - projection
   - line
   - prices
   - baseline side
   - actual result
   - contextual features
4. Universal model training consumes that row set.
5. Hybrid building combines the previous live candidate and the new candidate.
6. Residual calibration optionally adjusts qualification floors by `market x archetype x minutes bucket`.
7. Qualification evaluation scores the portfolio.
8. Promotion copies the best candidate into stable live aliases.

Important files in this flow:

- `scripts/export-historical-all-player-lines.ts`
- `scripts/backtest-projection-model.ts`
- `scripts/train-universal-archetype-side-models.ts`
- `scripts/build-universal-hybrid-model.ts`
- `scripts/build-universal-residual-calibration.ts`
- `scripts/evaluate-universal-model-qualification.ts`
- `scripts/retrain-live-universal-model.ts`

## 6. Current archetype system

### 6.1 Full live taxonomy

Current archetypes in `lib/snapshot/liveUniversalSideModels.ts`:

- `LEAD_GUARD`
- `TABLE_SETTING_LEAD_GUARD`
- `SCORE_FIRST_LEAD_GUARD`
- `HELIOCENTRIC_GUARD`
- `ELITE_SHOOTING_GUARD`
- `SCORING_GUARD_CREATOR`
- `JUMBO_CREATOR_GUARD`
- `WING`
- `CONNECTOR_WING`
- `SPOTUP_WING`
- `BENCH_GUARD`
- `BENCH_WING`
- `BENCH_LOW_USAGE_WING`
- `BENCH_MIDRANGE_SCORER`
- `BENCH_VOLUME_SCORER`
- `BENCH_CREATOR_SCORER`
- `BENCH_REBOUNDING_SCORER`
- `BENCH_SPACER_SCORER`
- `BENCH_BIG`
- `TWO_WAY_MARKET_WING`
- `SCORER_CREATOR_WING`
- `SHOT_CREATING_WING`
- `MARKET_SHAPED_SCORING_WING`
- `CENTER`
- `STRETCH_RIM_PROTECTOR_CENTER`
- `POINT_FORWARD`
- `LOW_MINUTE_BENCH`

### 6.2 Most recent archetype split

The latest model improvement targeted the remaining weak reserve scorer bucket `BENCH_SCORING_WING`, splitting it into three granular groups while adding `assistRate` and `astToLineRatio` variables for AST markets.

New reserve subtypes:

- `BENCH_LOW_USAGE_WING`
- `BENCH_MIDRANGE_SCORER`
- `BENCH_VOLUME_SCORER`

Current split logic inside `classifyBenchArchetype(...)`:

- if scoring reserve and `ast >= 3.2` -> `BENCH_CREATOR_SCORER`
- else if `reb >= 5.2` -> `BENCH_REBOUNDING_SCORER`
- else if `threes >= 1.9 || pts >= 15.5` -> `BENCH_SPACER_SCORER`
- else if `pts < 10 && threes < 1.0` -> `BENCH_LOW_USAGE_WING`
- else if `pts >= 10 && threes < 1.3` -> `BENCH_MIDRANGE_SCORER`
- else fallback -> `BENCH_VOLUME_SCORER`

Why this mattered:

- the old `BENCH_SCORING_WING` bucket was a large, noisy, high-impact drag
- splitting it gave the model more specialized trees for distinct reserve shapes
- the change improved both raw and blended portfolio accuracy

### 6.3 Important historical improvements already made

Major improvements from this development cycle:

- fixed training/live drift by using stable archetype minutes inputs
- moved from one global qualification gate to per-market gates
- added market-aware live qualification thresholds
- aligned live taxonomy with training taxonomy
- split broad `WING` and `LEAD_GUARD` buckets into more informative subtypes
- split `LOW_MINUTE_BENCH`
- added refresh cadence and health freshness reporting
- added retrain/promotion automation
- added residual calibration infrastructure
- latest gain came from the new reserve scorer subtype split

## 7. Training and hybrid strategy

### 7.1 Direct training

File:

- `scripts/train-universal-archetype-side-models.ts`

Important behavior:

- consumes backtest rows
- enriches rows with player meta and archetype
- chooses a per-market, per-archetype model variant
- supports selection strategy:
  - `in_sample`
  - `temporal_holdout`

Model families considered include:

- projection-based
- baseline/final override
- market-favored heuristics
- rule-based gap / quality / price variants
- decision trees

In practice, the strongest live picks are overwhelmingly tree-based.

### 7.2 Hybrid build

File:

- `scripts/build-universal-hybrid-model.ts`

Purpose:

- build a composite artifact by choosing the best candidate model for each `market x archetype`

Selection strategies:

- `late_then_full`
- `full_then_late`

Current retrain pipeline uses:

- direct training: `--selection-strategy in_sample`
- hybrid build: `--selection-strategy full_then_late`

This means:

- the direct model tries to maximize raw per-slice fit on the current rows
- the hybrid model then chooses slice winners between the previous live candidate and the new candidate

## 8. Qualification system

### 8.1 Why qualification exists

The universal model should not override the baseline on every row. Qualification exists because:

- some market/archetype slices are high quality
- some slices are only marginally useful
- portfolio-level performance improves when weak slices are neutralized or allowed to fall back

### 8.2 Current live thresholds

Global defaults:

- `minBucketLateAccuracy = 56`
- `minBucketSamples = 0`
- `minLeafAccuracy = 67`
- `minLeafCount = 0`

Per-market leaf overrides currently live:

- `PTS = 58`
- `REB = 60`
- `AST = 58`
- `THREES = 60`
- `PRA = 58`
- `PA = 61`
- `PR = 60`
- `RA = 62`

Current best configuration is still per-market overrides only.

Important finding:

- archetype-specific leaf-floor overrides were implemented but not promoted because they did not improve blended accuracy enough

## 9. Residual calibration

### 9.1 What it is

Files:

- `lib/snapshot/universalResidualCalibration.ts`
- `scripts/build-universal-residual-calibration.ts`

Calibration groups are keyed by:

- `market`
- `archetype`
- `minutesBucket`

The builder:

- looks at last `7` and `14` days
- compares recent accuracy to full accuracy
- computes optional bucket and leaf accuracy adjustments
- can run in:
  - `penalties_only`
  - `symmetric`

Current live calibration file:

- `exports/universal-live-calibration.json`

Current live state:

- calibration is intentionally neutral
- `records` is currently empty

Why:

- the calibrated candidates were tested
- they improved qualified accuracy in some cases
- they did not beat the uncalibrated hybrid on blended accuracy

This is important for future agents:

- calibration infrastructure exists
- it is not dead code
- it just has not yet found a profitable live adjustment set

## 10. Automation and schedules

### 10.1 Refresh automation

Files:

- `.github/workflows/snapshot-refresh.yml`
- `vercel.json`

Current schedules:

- `30 5 * * *` -> delta refresh -> `1:30 AM ET`
- `15 12 * * *` -> delta refresh -> `8:15 AM ET`
- `10 14 * * *` -> full refresh -> `10:10 AM ET`

This was added because the system previously did not reliably ingest completed games soon enough after they ended.

### 10.2 Retrain automation

File:

- `.github/workflows/universal-model-retrain.yml`

Current schedule:

- `45 14 * * *` -> `10:45 AM ET`

Requirements:

- GitHub Actions `DATABASE_URL` secret must exist

Behavior:

- checks out repo
- installs dependencies
- generates Prisma client
- runs `npm run projection:retrain:universal-live`
- commits updated artifacts under `exports/` if they changed

## 11. Commands that matter

### 11.1 Main local commands

```bash
npm run projection:lines:export:all-markets
npm run projection:retrain:universal-live
npm run projection:evaluate:universal-qualification
npm run projection:build:universal-calibration
npm run refresh:delta
npm run refresh:full
npx tsc --noEmit
npx eslint lib/snapshot/liveUniversalSideModels.ts scripts/train-universal-archetype-side-models.ts scripts/build-universal-hybrid-model.ts scripts/retrain-live-universal-model.ts
npx next build
npx vercel --prod --yes
```

### 11.2 Useful direct evaluation overrides

Evaluate a specific candidate artifact:

```bash
$env:SNAPSHOT_UNIVERSAL_MODEL_FILE='exports\\your-model.json'
npm run projection:evaluate:universal-qualification
```

Disable calibration during evaluation:

```bash
$env:SNAPSHOT_UNIVERSAL_DISABLE_CALIBRATION='1'
npm run projection:evaluate:universal-qualification
```

Use a specific calibration file:

```bash
$env:SNAPSHOT_UNIVERSAL_MODEL_FILE='exports\\your-model.json'
$env:SNAPSHOT_UNIVERSAL_CALIBRATION_FILE='exports\\your-calibration.json'
npm run projection:evaluate:universal-qualification
```

### 11.3 Live smoke checks

Production health:

```powershell
Invoke-RestMethod 'https://compliance-reminder-saas.vercel.app/api/health' | ConvertTo-Json -Depth 8
```

Manual refresh:

```powershell
Invoke-RestMethod 'https://compliance-reminder-saas.vercel.app/api/refresh' -Method POST -ContentType 'application/json' -Body '{\"mode\":\"DELTA\"}'
```

## 12. Current bottlenecks

I ran a fresh slice analysis on the current live winner after the reserve-scorer split. The weakest remaining high-volume qualified slices are:

| Market | Archetype | Samples | Qualified Picks | Qualified | Coverage | Blended |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| PTS | `BENCH_SCORING_WING` | 2,498 | 2,313 | 61.39% | 92.59% | 60.13% |
| AST | `BENCH_SCORING_WING` | 2,286 | 1,169 | 63.73% | 51.14% | 59.06% |
| AST | `BENCH_BIG` | 1,005 | 909 | 64.91% | 90.45% | 64.28% |
| THREES | `BENCH_SCORING_WING` | 1,044 | 1,023 | 65.10% | 97.99% | 64.75% |
| PTS | `BENCH_GUARD` | 1,118 | 1,081 | 65.22% | 96.69% | 64.49% |
| REB | `BENCH_SPACER_SCORER` | 752 | 677 | 65.44% | 90.03% | 63.16% |
| AST | `WING` | 645 | 645 | 65.58% | 100.00% | 65.58% |
| REB | `BENCH_GUARD` | 1,090 | 992 | 65.63% | 91.01% | 64.22% |
| AST | `CENTER` | 684 | 675 | 65.63% | 98.68% | 65.35% |
| PTS | `LEAD_GUARD` | 946 | 922 | 65.73% | 97.46% | 65.43% |

Takeaway:

- the latest split helped, but `BENCH_SCORING_WING` is still not fully resolved
- assist markets remain the weakest broad area
- there is still too much coverage on several weak slices

## 13. Best next experiments

If another agent picks this up, the highest-value next moves are:

1. Split the remaining `BENCH_SCORING_WING` fallback bucket again.
2. Attack `AST` directly, especially:
   - `BENCH_SCORING_WING`
   - `BENCH_BIG`
   - `WING`
   - `CENTER`
3. Add archetype-specific features for weak assist slices instead of only tightening gates.
4. Test market-specific subtree depth or leaf-size settings for `AST` and `PTS`.
5. Re-evaluate residual calibration after more fresh labeled rows exist beyond `2026-03-09`.
6. Create a dedicated slice-analysis script so future agents do not need inline ad hoc analysis.

What not to do first:

- do not chase tighter global gates again
- do not optimize only for qualified accuracy
- do not assume calibration helps just because it exists
- do not assume the live artifact filename inside the promotion summary accurately reflects the latest taxonomy changes

## 14. Important gotchas

### 14.1 The promoted filename can be misleading

The stable live alias file is the real source of truth:

- `exports/universal-archetype-side-models-live.json`

The promotion summary may still mention a date-stamped filename that contains old naming like `wing-guard-split`. That does not necessarily mean the content is old. The retrain wrapper still uses those fixed output names unless updated.

### 14.2 Calibration is live-wired but neutral

`exports/universal-live-calibration.json` is currently a neutral file with empty records. That is intentional.

### 14.3 Training rows are not as fresh as live box score ingestion

Production freshness currently reaches `2026-03-12`, but the promoted model summary still shows training/eval rows through `2026-03-09`. This means:

- live data ingestion is fresher than the current labeled retrain dataset
- retraining cadence is now automated, but the labeled row generation cadence still matters

### 14.4 The worktree is noisy

There are many unrelated untracked files under `exports/` and various temporary HTML / JS files in the repo root. Future agents should not blindly stage or delete everything.

## 15. Practical first steps for a future agent

If a future model picks this up, the fastest sane sequence is:

1. Read this file.
2. Read:
   - `lib/snapshot/liveUniversalSideModels.ts`
   - `scripts/train-universal-archetype-side-models.ts`
   - `scripts/build-universal-hybrid-model.ts`
   - `scripts/retrain-live-universal-model.ts`
   - `scripts/evaluate-universal-model-qualification.ts`
3. Check current live metrics:
   - `exports/universal-live-promotion.json`
   - `exports/universal-model-qualification-eval.json`
4. Check production freshness:
   - `/api/health`
5. Reproduce locally:
   - `npm run projection:evaluate:universal-qualification`
6. Analyze current worst slices before changing thresholds.
7. Prefer model-quality improvements over more gate tightening.

## 16. Short status summary

This system is already live and materially improved relative to the earlier universal model versions.

Current state in one sentence:

The universal model is now a live hybrid archetype-aware side selector with per-market qualification, automated refreshes, automated retraining, neutral-but-available recency calibration, and a best verified blended accuracy of `67.16%` on the current labeled backtest set.
