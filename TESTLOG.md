# TESTLOG — sokoban-solver-01-run-20261121

Entry: `main.ts` — push-optimal A* per room (assignment heuristic,
dead-square + frozen-2x2 pruning), room decomposition via hallway cut,
whole-level push-A* fallback, work-based state budgets only (no clock).

## Practice set (kit, drawn from drand round 34141021)

| instance | P* (pushes) | solver pushes | points | moves |
|----------|-------------|---------------|--------|-------|
| i001 | 13 | 13 | 1000 | 46 |
| i002 | 16 | 16 | 1000 | 77 |
| i003 | 29 | 29 | 1000 | 108 |
| i004 | 47 | 47 | 1000 | 209 |
| i005 | 60 | 60 | 1000 | 299 |

Practice score: **1,000,000** (all 5 at P*). Wall time for the whole
set: ~0.43 s (limit 60 s). Kit `grade-local --driver process`: score
1,000,000, answered 5, passed 1, eligible ranked yes / prize yes, L1
regrade reproduced byte for byte (deterministic).

House baseline (plain-astar) on the same practice set: **200,000**
(only i001 solved; i002–i005 unsolved, 0 points). This entry beats it
by 800,000.

## Held-out sets (fresh draws from the kit generator, seeds unrelated
## to the practice set; P* from each draw's own key)

| set | i001 | i002 | i003 | i004 | i005 | score | wall |
|-----|------|------|------|------|------|-------|------|
| holdout-a | 12 | 14 | 32 | 44 | 61 | 1,000,000 | ~0.55 s |
| holdout-b | 14 | 14 | 31 | 44 | 62 | 1,000,000 | ~0.45 s |
| holdout-c | 15 | 14 | 32 | 46 | 64 | 1,000,000 | ~0.45 s |
| holdout-d | 14 | 14 | 29 | 43 | 66 | 1,000,000 | — |
| holdout-e | 17 | 14 | 29 | 44 | 59 | 1,000,000 | — |

Every instance in every held-out set solved at exactly P* (1000 pts).
25/25 held-out instances at P*. No dev-only tuning: nothing was tuned
to the practice levels; the same code solved all fresh draws.

## Determinism

Two runs on holdout-a produce byte-identical `solution.txt` files
(`diff -r` clean). `grade-local` L1 regrade reproduced byte for byte.

## Revisions

- v1: push-optimal A* per room, 400k states/room cap. Practice
  1,000,000; held-out a–c 1,000,000 each.
- v2 (edit after the v1 test): on a room search giving up, retry that
  room once with a 1.6M-state cap; added a run-wide 6M-state budget so
  a pathological set cannot eat the 60 s wall budget. Re-tested:
  outputs byte-identical to v1 on practice + all 5 held-out sets
  (retry never triggered), `grade-local` still 1,000,000.

## Caveats

- The scored set is drawn after the deadline from a drand round nobody
  can know in advance; practice and held-out scores are the best
  available proxy, not a guarantee.
- The entry assumes the generator's level shape (hallway + rooms off
  it). If a scored level did not split into rooms, the whole-level
  push-A* fallback runs instead; if that also gives up, the entry
  writes an empty (valid, 0-point) solution rather than crashing.
