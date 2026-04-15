## Five-Player 61 Repair

Goal: repair the April 15 five-player manifest so Nickeil Alexander-Walker, Desmond Bane, Moses Moody, John Konchar, and Lauri Markkanen all clear `61.00%` raw accuracy on full history, recent `14d`, and recent `30d`, with no regression versus the active live manifest on any of those three windows.

Method:
- Start from the active live board as the benchmark.
- Search deployable market-by-market mixes using the current manifest plus the current base target-lift candidate pool.
- Keep only mixes that are valid manifest rules.
- Promote the best mix only if it clears the `61` floor and beats or matches the active manifest on full, `14d`, and `30d`.

Verified live manifest-on results after promotion:
- Nickeil Alexander-Walker: `67.26 / 72.22 / 69.44`
- Desmond Bane: `64.71 / 65.71 / 65.33`
- Moses Moody: `69.69 / 68.75 / 71.88`
- John Konchar: `77.14 / 76.00 / 76.32`
- Lauri Markkanen: `71.17 / 75.00 / 71.43`

Pre-promotion board replay versus the prior active live manifest:
- Full raw: `58.89 -> 59.02` (`+0.13`)
- Full blended: `58.59 -> 58.72` (`+0.13`)
- Recent `14d` raw: `58.60 -> 58.75` (`+0.15`)
- Recent `30d` raw: `58.28 -> 58.50` (`+0.22`)

Manifest outcome:
- The active manifest was promoted from `v14` to `v15`.
- All five repaired entries now use the `beam_recent_safe_market_mix_v1` label to distinguish them from the earlier one-family promotion.
