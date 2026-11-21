// Sokoban solver: push-optimal A* per room, with deadlock pruning.
// Entry for make.fun sokoban-solver-01-run-20261121 (main.ts at repo root, Node 22).
//
// Design (own implementation):
// - A level is a hallway with 1-4 rooms off it; a box pushed out of a room
//   into the hallway can never come back, so rooms are independent: the
//   level's push-optimum is the sum of its rooms' optima. Split the level
//   into rooms by cutting the hallway's dead squares out of the floor, then
//   solve each room on its own with the other rooms' boxes treated as walls.
// - Inside a room, search over pushes (not steps): a state is the sorted box
//   squares plus the player's reachable region (named by its lowest square).
//   A* with g = pushes made and h = the cheapest assignment of boxes to
//   goals by grid distance (each push moves one box one square, so the
//   assignment sum never overestimates the pushes still needed). Ties break
//   toward deeper states, then by insertion order: fully deterministic.
// - Deadlock pruning: a box may only be pushed onto a "live" square (one
//   from which a box alone can still reach a goal, found by pulling back
//   from the goals), and a push that leaves a box frozen in a 2x2 block of
//   walls and boxes off its goal is dropped. Both prunes are safe: they
//   never cut a solvable state, so the first solved state A* pops is
//   push-optimal for the room.
// - Work budget only (a cap on generated states), never the wall clock, so
//   two runs of the entry answer byte for byte alike.
// - Fallback: if the level does not split into rooms, run the same push A*
//   over the whole level; if that also gives up, write an empty (valid)
//   solution rather than crashing.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// One search may generate at most this many states per room (and, for the
// whole-level fallback, per level). Work, never the clock.
const MAX_STATES = 400_000;
// A second, larger cap a room gets when the first search gives up: a harder
// scored room is worth one more attempt before the entry concedes it.
// TOTAL_STATE_BUDGET caps all generated states across the whole run, so a
// pathological set can never eat the 60-second wall budget. Both are work,
// never the clock, so two runs still answer byte for byte alike.
const RETRY_STATES = 1_600_000;
const TOTAL_STATE_BUDGET = 6_000_000;
let statesUsed = 0;

type Board = { w: number; h: number; wall: Uint8Array; goals: number[]; boxes: number[]; player: number };

const DIRS: [number, number, string][] = [
  [0, -1, 'u'],
  [0, 1, 'd'],
  [-1, 0, 'l'],
  [1, 0, 'r'],
];

function parseLevel(text: string): Board {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

// Grid distances from `from` over open floor (walls only, no boxes).
function bfsDist(wall: Uint8Array, w: number, from: number): Int32Array {
  const dist = new Int32Array(wall.length).fill(-1);
  const queue = [from];
  dist[from] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const q = p + dy * w + dx;
      if (!wall[q] && dist[q] < 0) {
        dist[q] = dist[p]! + 1;
        queue.push(q);
      }
    }
  }
  return dist;
}

// Squares from which a box alone can still be pushed onto some goal:
// pull back from the goals (a box at y can come from a push out of y-d
// only when the player could stand at y-d, i.e. y-d is open too).
function liveSquares(wall: Uint8Array, w: number, goals: number[]): Uint8Array {
  const live = new Uint8Array(wall.length);
  const queue = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

// Flood-fill the player's reachable region from `from` around walls and
// boxes; returns its lowest square and marks the region in `seen`.
function reachLow(
  wall: Uint8Array,
  w: number,
  occupied: Uint8Array,
  from: number,
  seen: Int32Array,
  stamp: number,
  stack: Int32Array,
): number {
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n]!;
    if (p < low) low = p;
    for (let k = 0; k < 4; k++) {
      const q = k === 0 ? p - w : k === 1 ? p + w : k === 2 ? p - 1 : p + 1;
      if (wall[q] === 0 && occupied[q] === 0 && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

// True when the box just pushed to `t` sits in a frozen 2x2 block of walls
// and boxes with a box off its goal.
function frozenBlock(wall: Uint8Array, w: number, occupied: Uint8Array, goal: Uint8Array, t: number): boolean {
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b]) || !(wall[c] || occupied[c]) || !(wall[d] || occupied[d]))
      continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d]))
      return true;
  }
  return false;
}

// Shortest walk from `from` to `to` around walls and boxes, lower-case
// letters, first direction first on ties. Throws when unreachable (the
// search only asks for reachable squares).
function walkTo(wall: Uint8Array, w: number, occupied: Uint8Array, from: number, to: number): string {
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array<string>(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: unreachable push square');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

// Push-optimal A* over one board. Returns { pushes, moves } or null when
// the state cap is hit or the board has no solution.
function solvePushAStar(board: Board, maxStates: number): { pushes: number; moves: string } | null {
  const { w, wall, goals } = board;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(wall, w, goals);
  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;
  const solved = (boxes: number[]): boolean => boxes.every((b) => goal[b]);
  if (board.boxes.some((b) => !live[b])) return null;

  // Heuristic: cheapest box->goal assignment by grid distance (ignoring
  // other boxes). Distances from each goal, then all permutations.
  const distFromGoal = goals.map((g) => bfsDist(wall, w, g));
  const n = board.boxes.length;
  const heuristic = (boxes: number[]): number => {
    let best = Infinity;
    const perm = goals.map((_, i) => i);
    const rec = (k: number, sum: number): void => {
      if (sum >= best) return;
      if (k === n) {
        best = sum;
        return;
      }
      for (let i = k; i < n; i++) {
        [perm[k], perm[i]] = [perm[i]!, perm[k]!];
        const d = distFromGoal[perm[k]!]![boxes[k]!]!;
        rec(k + 1, sum + (d < 0 ? 1e6 : d));
        [perm[k], perm[i]] = [perm[i]!, perm[k]!];
      }
    };
    rec(0, 0);
    return best;
  };

  const keyOf = (boxes: number[], low: number): number => {
    let k = low;
    for (const b of boxes) k = k * size + b;
    return k;
  };

  // State storage: boxes, player square, parent, the push that made it.
  const stBoxes: number[][] = [board.boxes];
  const stPlayer: number[] = [board.player];
  const stParent: number[] = [-1];
  const stFrom: number[] = [-1];
  const stTo: number[] = [-1];
  const stG: number[] = [0];
  const bestG = new Map<number, number>();
  for (const b of board.boxes) occupied[b] = 1;
  bestG.set(keyOf(board.boxes, reachLow(wall, w, occupied, board.player, seen, ++stamp, stack)), 0);
  for (const b of board.boxes) occupied[b] = 0;

  // Binary heap on [f, -g, id]: lowest f first, deeper first on ties.
  const heap: [number, number, number][] = [[heuristic(board.boxes), 0, 0]];
  const less = (a: [number, number, number], b: [number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  const heapPush = (e: [number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const heapPop = (): [number, number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++;
        if (!less(heap[c]!, heap[i]!)) break;
        [heap[i], heap[c]] = [heap[c]!, heap[i]!];
        i = c;
      }
    }
    return top;
  };

  let found = solved(board.boxes) ? 0 : -1;
  while (heap.length > 0 && found < 0) {
    const [, negG, s] = heapPop();
    const g = -negG;
    if (stG[s] !== g) continue; // stale heap entry
    const boxes = stBoxes[s]!;
    for (const b of boxes) occupied[b] = 1;
    reachLow(wall, w, occupied, stPlayer[s]!, seen, ++stamp, stack);
    const here = stamp;
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi]!;
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        if (seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(wall, w, occupied, goal, t);
        let key = -1;
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((x, y) => x - y);
          key = keyOf(next, reachLow(wall, w, occupied, b, mark, ++stamp, stack));
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || next === null) continue;
        const prevG = bestG.get(key);
        if (prevG !== undefined && prevG <= g + 1) continue;
        if (stBoxes.length >= maxStates || statesUsed >= TOTAL_STATE_BUDGET) {
          for (const x of boxes) occupied[x] = 0;
          return null;
        }
        statesUsed++;
        bestG.set(key, g + 1);
        const id = stBoxes.length;
        stBoxes.push(next);
        stPlayer.push(b);
        stParent.push(s);
        stFrom.push(b);
        stTo.push(t);
        stG.push(g + 1);
        if (solved(next)) {
          found = id;
          break;
        }
        heapPush([g + 1 + heuristic(next), -(g + 1), id]);
      }
    }
    for (const x of boxes) occupied[x] = 0;
  }
  if (found < 0) return null;

  // Rebuild the moves: walk to each push square, then push.
  const path: number[] = [];
  for (let s = found; s > 0; s = stParent[s]!) path.push(s);
  path.reverse();
  let moves = '';
  let player = board.player;
  let boxes = board.boxes;
  for (const s of path) {
    const nextBoxes = stBoxes[s]!;
    const from = stFrom[s]!;
    const to = stTo[s]!;
    const d = to - from;
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(wall, w, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    moves += d === -w ? 'u' : d === w ? 'd' : d === -1 ? 'l' : 'r';
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

// The level's rooms: cut the dead squares of the player's row (the
// hallway: a box there reaches no goal) out of the floor; each remaining
// part holding a box is a room. Null when the level is no set of rooms.
function roomsOf(level: Board): { squares: number[]; boxes: number[]; goals: number[]; done: boolean }[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(wall, w, goals);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !live[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: { squares: number[]; boxes: number[]; goals: number[]; done: boolean }[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i]! + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [], done: false });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) if (part[g]! >= 0) rooms[part[g]!]!.goals.push(g);
  if (goals.some((g) => part[g]! < 0)) return null;
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

// Solve one level room by room; whole-level push A* when it is no set of
// rooms. Returns the move string ('' when unsolved).
function solveLevel(level: Board): string {
  const rooms = roomsOf(level);
  if (rooms !== null) {
    let player = level.player;
    let moves = '';
    for (const room of rooms) {
      const wall = level.wall.slice();
      for (const other of rooms)
        if (other !== room) for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
      const sub: Board = {
        w: level.w,
        h: level.h,
        wall,
        goals: room.goals.slice().sort((a, b) => a - b),
        boxes: room.boxes.slice().sort((a, b) => a - b),
        player,
      };
      const solved = solvePushAStar(sub, MAX_STATES) ?? solvePushAStar(sub, RETRY_STATES);
      if (solved === null) return '';
      moves += solved.moves;
      // The player's square after the room's moves.
      for (const ch of solved.moves) player += ch === 'u' ? -level.w : ch === 'd' ? level.w : ch === 'l' ? -1 : 1;
      room.done = true;
    }
    return moves;
  }
  const solved = solvePushAStar(level, MAX_STATES);
  return solved === null ? '' : solved.moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solveLevel(parseLevel(readFileSync(join(I, id, 'level.txt'), 'utf8')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
