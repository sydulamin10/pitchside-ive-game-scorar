# Scoring rules

What the engine actually implements, why the awkward cases are the way they are, and
how the Python and TypeScript versions are kept identical.

The authority for all of it is `spec/scoring-fixtures.json`. If you disagree with
anything below, the honest way to argue is to add a fixture.

## Deliveries

| Delivery      | Advances the over? | Ball faced? | Charged to the bowler? |
| ------------- | ------------------ | ----------- | ---------------------- |
| Fair ball     | yes                | yes         | runs off the bat        |
| Wide          | **no**             | **no**      | yes (penalty + runs run)|
| No-ball       | **no**             | **yes**     | yes (penalty + bat runs)|
| Bye           | yes                | yes         | **no**                  |
| Leg-bye       | yes                | yes         | **no**                  |
| Penalty award | no (not a ball)    | no          | **no**                  |

Three of those rows are where most scoring software goes wrong:

- A **no-ball is a ball faced**. The batter was there and played at it, so it counts in
  their balls-faced column and therefore in their strike rate. A wide is not.
- **Byes and leg-byes are not the bowler's fault.** They occurred off a fair delivery
  that beat the keeper. Charging them to the bowler inflates every economy rate in the
  match — and, worse, breaks maidens that should have stood.
- **A maiden survives a bye.** An over is a maiden when the bowler is charged nothing.
  Four byes off it is still a maiden; a single wide is not.

The wide and no-ball penalties are match rules (`wide_penalty_runs`,
`no_ball_penalty_runs`), because tape-ball and box cricket routinely play two-run
wides.

## Strike rotation

Rotation is decided by **crossings**, not by a guess from the runs. The scorer can
state it explicitly with `batters_crossed`; when they do not, the engine uses the
parity of the runs actually run, and then swaps again at the end of every over.

The cases that need the explicit flag:

- **Four wides.** The ball went to the rope without the batters crossing, so the strike
  does not change — even though four runs were scored.
- **A caught dismissal.** Whether the new batter is on strike depends on whether the
  batters had crossed before the catch was taken.
- **A run out.** Same question, and the answer changes who faces the next ball.

Because rotation is derived from the log rather than stored per ball, correcting an
early delivery re-derives who was on strike for every ball after it. Where the stored
log then disagrees with the replay, the engine emits a `StrikeRepair` and the service
layer writes it back, so the log stays self-consistent rather than accumulating a
quiet contradiction.

## Free hits

A no-ball sets a free hit, which survives until the next **legal** delivery — so a
wide bowled on a free hit does not consume it. During a free hit only run-out style
dismissals are possible; an attempt to record bowled, caught, LBW or stumped is
refused with `wicket_illegal_on_free_hit`.

Whether a no-ball produces a free hit at all is a match rule
(`free_hit_after_no_ball`, on by default), so formats that do not use it can turn it
off rather than having the engine argue with the scorer.

## Dismissals

Twelve types. Which are legal depends on the delivery:

| Delivery   | Allowed dismissals                                                          |
| ---------- | --------------------------------------------------------------------------- |
| Fair ball  | all twelve                                                                  |
| No-ball    | run out, obstructing the field, hit the ball twice, retired out, retired hurt |
| Wide       | run out, stumped, hit wicket, obstructing the field, retired out, retired hurt |
| Free hit   | as no-ball                                                                  |
| Penalty    | none (`wicket_on_penalty`)                                                  |

Other rules the engine enforces rather than trusting:

- **Credit to the bowler** goes only to bowled, caught, caught & bowled, LBW, stumped
  and hit wicket. A run out is not a bowler's wicket, and it does not appear in their
  figures.
- **A fielder is required** for caught, run out and stumped, and must be a member of
  the fielding side (`unknown_fielder`, `invalid_fielder_for_wicket`).
- **Retired hurt is not a wicket.** The batter keeps their runs, does not count toward
  the all-out condition, and remains available to come back in later.
- **Retired out is a wicket** and the batter does not return.
- The dismissed player must be one of the two at the crease, and a replacement must be
  someone who has not batted and is not already at the crease.

The dismissal line on the scorecard is composed by the engine
(`c Imran b Rakib`, `run out (Karim)`, `lbw b Rakib`) rather than typed by the scorer.

## An innings ending

An innings closes when any of these is true, and the reason is recorded:

| Reason           | Condition                                                            |
| ---------------- | -------------------------------------------------------------------- |
| `all_out`        | wickets reach `players_per_side − 1`, or `players_per_side` where the last batter may bat alone |
| `overs_complete` | legal balls reach `overs_limit × balls_per_over`                       |
| `target_reached` | the chasing side passes its target                                    |
| `declared`       | the batting side declares                                             |
| `rain`, `forfeit`, `other` | recorded by the scorer                                      |

`players_per_side`, `balls_per_over` and `last_batter_can_bat_alone` are all match
rules, because six-a-side box cricket with eight-ball overs is a real fixture and
should not need a different app.

## Net run rate

Two rules, and both of them favour somebody when they are wrong:

1. **A side bowled out is charged its full quota of overs.** Dismissed for 60 in 12
   overs of a 20-over match counts as 60 from 20, not 60 from 12. This is the ICC
   treatment and it is the single most common club-table error.
2. **Overs convert honestly.** 17.3 overs is 17.5 overs of run rate, because the
   decimal is a ball count, not a fraction. Treating `.3` as three tenths silently
   moves every NRR in the table.

Abandoned and no-result matches are excluded from run rate entirely while still
awarding their points. Points deductions are applied to the total and shown against
the team, so an odd-looking order can always be explained.

Ties are broken in this order: points (including any adjustment), then net run rate if
the tournament uses it, then wins, then team name — so the order is stable rather than
arbitrary, and identical on every device that computes it.

## Validation, with codes

Every refusal carries a machine-readable code, so the console can point at the control
that is wrong instead of showing a generic message. The full set lives in
`validate_delivery`; the ones a scorer meets in practice:

| Code                            | Means                                                     |
| ------------------------------- | --------------------------------------------------------- |
| `innings_complete`              | The innings is over; nothing more can be recorded          |
| `batters_identical`             | The same player was given as striker and non-striker       |
| `batter_already_out`            | That batter has already been dismissed                     |
| `too_many_new_batters`          | Only one new batter comes in at a time (two at the start)   |
| `consecutive_overs`             | A bowler cannot bowl two overs in succession               |
| `bowler_changed_mid_over`       | The bowler changed part-way through an over                |
| `wicket_illegal_on_free_hit`    | Only a run-out style dismissal is possible on a free hit    |
| `wicket_illegal_on_no_ball`     | That dismissal cannot happen off a no-ball                  |
| `wicket_illegal_on_wide`        | That dismissal cannot happen off a wide                     |
| `missing_fielder`               | That dismissal needs a fielder named                        |
| `bat_runs_with_extra`           | Runs off the bat cannot accompany a wide or a bye            |
| `log_inconsistent`              | A replay found a log that could not have happened            |

## How the two engines stay identical

The engine exists twice — `backend/app/scoring/engine.py` and
`frontend/src/lib/scoring/engine.ts` — because the browser needs it to validate a ball
instantly and to project the score while offline, and the server needs it as the
authority.

Two copies of a rule set is a liability unless something forces them to agree. That
something is `spec/scoring-fixtures.json`:

```
spec/scoring-fixtures.json
├── cases[]             replay a delivery log, assert the resulting innings state
├── validation_cases[]  a candidate delivery and the error code it must produce
└── standings_cases[]   match outcomes and the points table they must produce
```

- `backend/tests/test_engine_fixtures.py` runs them against the Python engine.
- `frontend/src/lib/scoring/engine.test.ts` and `standings.test.ts` run the same file
  against the TypeScript engine.

**Changing a rule means editing the fixtures first**, watching both suites fail, and
then making both engines pass. A rule change that touches only one language is a bug
by construction: the score a scorer sees offline would stop matching the score the
server computes when the ball syncs.

Rounding is aligned too — the TypeScript side reimplements Python's half-even
rounding — so a strike rate of 133.335 does not display as two different numbers on
two devices.
