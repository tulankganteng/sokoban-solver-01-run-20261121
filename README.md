# Sokoban solver — make.fun sokoban-solver-01-run-20261121

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/tulankganteng/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/tulankganteng/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

**Entry for the make.fun bounty [sokoban-solver-01-run-20261121](https://make.fun/bounty/sokoban-solver-01-run-20261121) ($100, deadline Mon 2026-11-23 10:00 WIB).** `main.ts` at the repo root (Node 22, no
dependencies, no network, no clock, deterministic).

## How it works

A level is a hallway with 1–4 rooms off it, and a box pushed out of a
room into the hallway can never come back — so the rooms are
independent problems and the level's push-optimum is the sum of its
rooms' optima. The solver:

1. Splits the level into rooms by cutting the hallway's dead squares
   out of the floor (each remaining part holding boxes is a room).
2. Solves each room on its own with the other rooms' boxes treated as
   walls, then walks the player on to the next room.
3. Inside a room, runs A* over pushes (not steps): a state is the
   sorted box squares plus the player's reachable region. The
   heuristic is the cheapest assignment of boxes to goals by grid
   distance, which never overestimates the pushes still needed, so the
   first solved state popped is push-optimal for the room.
4. Prunes deadlocks safely: boxes may only be pushed onto "live"
   squares (reachable to a goal by pull-back from the goals), and a
   push that freezes a box in a 2×2 block of walls and boxes off its
   goal is dropped.
5. Budgets by work only (state caps, plus a run-wide cap), never by the
   wall clock, so two runs answer byte for byte alike. If a room's
   search gives up, it retries once with a larger cap; if the level
   does not split into rooms, a whole-level push A* runs instead.

## Local test

```
mkdir -p out
MAKEFUN_INPUT_DIR=<practice/input or any set dir> MAKEFUN_OUTPUT_DIR=out node main.ts
```

See `TESTLOG.md`: practice set 1,000,000 (all 5 instances at their
push-optimum), 25/25 held-out instances drawn fresh from the kit
generator also at their push-optimum, house baseline 200,000 on the
same practice set.
