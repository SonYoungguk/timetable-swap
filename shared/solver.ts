// 자동 편성: 탐욕 배치로 초안을 만들고 담금질(simulated annealing)로 다듬는다.
// 화면(웹 워커)과 테스트 스크립트가 같이 쓰므로 DOM·Node 전용 기능은 쓰지 않는다.

import { lessonRooms, lessonTeachers, unitId } from './model.ts';
import { getSettings } from './types.ts';
import type { Db } from './types.ts';

export interface SolveOptions {
  /** all: 고정된 수업만 두고 전부 다시 짠다. fill: 이미 놓인 수업은 그대로 두고 빈 것만 채운다. */
  mode: 'all' | 'fill';
  timeMs: number;
  seed?: number;
  onProgress?: (p: SolveProgress) => void;
}

export interface SolveProgress {
  /** 0~1 */
  ratio: number;
  hard: number;
  soft: number;
}

export interface SolveResult {
  /** 수업 덩어리 id → 자리. 여기 없는 덩어리는 자리를 찾지 못한 것. */
  placed: Record<string, { day: number; period: number }>;
  unplaced: string[];
  soft: number;
  iterations: number;
}

const W_HARD = 100;
const W_GAP = 20;
const W_SAME_DAY = 12;
const W_PER_DAY = 5;
const W_CONSEC = 4;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function solve(db: Db, opts: SolveOptions): SolveResult {
  const s = getSettings(db);
  const rand = rng(opts.seed ?? 1);
  const D = s.days.length;

  // ── 시간 칸 ──
  const slotDay: number[] = [];
  const slotPer: number[] = [];
  const dayStart: number[] = [];
  for (let d = 0; d < D; d++) {
    dayStart.push(slotDay.length);
    for (let p = 1; p <= s.periodsPerDay[d]; p++) {
      slotDay.push(d);
      slotPer.push(p);
    }
  }
  const S = slotDay.length;
  const slotOf = (day: number, period: number) =>
    day >= 0 && day < D && period >= 1 && period <= s.periodsPerDay[day] ? dayStart[day] + period - 1 : -1;
  const validStarts = new Map<number, number[]>();
  const startsFor = (len: number) => {
    let v = validStarts.get(len);
    if (!v) {
      v = [];
      for (let i = 0; i < S; i++) {
        const p = slotPer[i];
        if (p + len - 1 > s.periodsPerDay[slotDay[i]]) continue;
        if (len > 1 && p <= s.lunchAfter && p + len - 1 > s.lunchAfter) continue;
        v.push(i);
      }
      validStarts.set(len, v);
    }
    return v;
  };

  // ── 자원(교사·학급·교실) ──
  const resId = new Map<string, number>();
  const resKind: number[] = []; // 0 교사, 1 학급, 2 교실
  const res = (kind: number, id: string) => {
    const k = `${kind}:${id}`;
    let r = resId.get(k);
    if (r === undefined) {
      r = resKind.length;
      resId.set(k, r);
      resKind.push(kind);
    }
    return r;
  };
  for (const t of Object.values(db.teachers)) res(0, t.id);
  for (const c of Object.values(db.classes)) res(1, c.id);
  for (const r of Object.values(db.rooms)) res(2, r.id);

  // ── 수업 덩어리 ──
  const lessons = Object.values(db.lessons);
  const uId: string[] = [];
  const uLen: number[] = [];
  const uLesson: number[] = [];
  const uRes: number[][] = [];
  const uFixed: boolean[] = [];
  const uPos: number[] = [];
  lessons.forEach((lesson, li) => {
    const rs = [
      ...lessonTeachers(lesson).map((id) => res(0, id)),
      ...lesson.classIds.map((id) => res(1, id)),
      ...lessonRooms(lesson).map((id) => res(2, id)),
    ];
    lesson.blocks.forEach((len, idx) => {
      const id = unitId(lesson.id, idx);
      const pl = db.placements[id];
      const at = pl ? slotOf(pl.day, pl.period) : -1;
      const keep = !!pl && at >= 0 && (pl.pinned || opts.mode === 'fill');
      uId.push(id);
      uLen.push(len);
      uLesson.push(li);
      uRes.push(rs);
      uFixed.push(keep);
      uPos.push(keep ? at : -1);
    });
  });
  const U = uId.length;
  const R = resKind.length;

  const unavail = new Uint8Array(R * S);
  for (const t of Object.values(db.teachers)) {
    const r = res(0, t.id);
    for (const key of t.unavailable) {
      const [d, p] = key.split('-').map(Number);
      const i = slotOf(d, p);
      if (i >= 0) unavail[r * S + i] = 1;
    }
  }

  // ── 상태 ──
  const occ = new Int16Array(R * S);
  /** 칸에 놓인 덩어리 하나 (겹쳤을 때는 정확하지 않아 주기적으로 다시 만든다) */
  const cellUnit = new Int32Array(R * S).fill(-1);
  const lessonDay = new Int16Array(lessons.length * D);
  let hard = 0;

  const add = (u: number, at: number) => {
    const len = uLen[u];
    for (const r of uRes[u]) {
      for (let k = 0; k < len; k++) {
        const c = r * S + at + k;
        if (occ[c] >= 1) hard++;
        if (unavail[c]) hard++;
        occ[c]++;
        cellUnit[c] = u;
      }
    }
    lessonDay[uLesson[u] * D + slotDay[at]]++;
    uPos[u] = at;
  };
  const remove = (u: number) => {
    const at = uPos[u];
    const len = uLen[u];
    for (const r of uRes[u]) {
      for (let k = 0; k < len; k++) {
        const c = r * S + at + k;
        if (occ[c] > 1) hard--;
        if (unavail[c]) hard--;
        occ[c]--;
        if (cellUnit[c] === u) cellUnit[c] = -1;
      }
    }
    lessonDay[uLesson[u] * D + slotDay[at]]--;
    uPos[u] = -1;
  };

  /** 자원 r 의 d 요일 권장 사항 위반 점수 */
  const resDayCost = (r: number, d: number) => {
    const kind = resKind[r];
    if (kind === 2) return 0;
    const base = r * S + dayStart[d];
    const n = s.periodsPerDay[d];
    if (kind === 1) {
      let last = -1;
      let filled = 0;
      for (let p = 0; p < n; p++)
        if (occ[base + p] > 0) {
          last = p;
          filled++;
        }
      return (last + 1 - filled) * W_GAP;
    }
    let total = 0;
    let run = 0;
    let over = 0;
    for (let p = 0; p < n; p++) {
      if (occ[base + p] > 0) {
        total++;
        run++;
        if (run > s.maxTeacherConsecutive) over++;
      } else run = 0;
      if (p + 1 === s.lunchAfter) run = 0;
    }
    return Math.max(0, total - s.maxTeacherPerDay) * W_PER_DAY + over * W_CONSEC;
  };
  const lessonDayCost = (li: number, d: number) => Math.max(0, lessonDay[li * D + d] - 1) * W_SAME_DAY;

  const softTotal = () => {
    let sum = 0;
    for (let r = 0; r < R; r++) for (let d = 0; d < D; d++) sum += resDayCost(r, d);
    for (let li = 0; li < lessons.length; li++) for (let d = 0; d < D; d++) sum += lessonDayCost(li, d);
    return sum;
  };

  // 이동 전후로 달라질 수 있는 (자원, 요일)·(수업, 요일) 만 다시 계산한다.
  const stamp = new Int32Array(R * D);
  const lstamp = new Int32Array(lessons.length * D);
  let tick = 0;
  const touchedRD: number[] = [];
  const touchedLD: number[] = [];
  const touch = (u: number, at: number) => {
    if (at < 0) return;
    const d = slotDay[at];
    for (const r of uRes[u]) {
      const k = r * D + d;
      if (stamp[k] !== tick) {
        stamp[k] = tick;
        touchedRD.push(k);
      }
    }
    const lk = uLesson[u] * D + d;
    if (lstamp[lk] !== tick) {
      lstamp[lk] = tick;
      touchedLD.push(lk);
    }
  };
  const touchedCost = () => {
    let sum = 0;
    for (const k of touchedRD) sum += resDayCost((k / D) | 0, k % D);
    for (const k of touchedLD) sum += lessonDayCost((k / D) | 0, k % D);
    return sum;
  };

  /** 여러 덩어리를 한꺼번에 옮기고 점수 변화를 돌려준다. */
  const applyMoves = (us: number[], tos: number[]) => {
    tick++;
    touchedRD.length = 0;
    touchedLD.length = 0;
    for (let i = 0; i < us.length; i++) {
      touch(us[i], uPos[us[i]]);
      touch(us[i], tos[i]);
    }
    const before = touchedCost() + hard * W_HARD;
    for (const u of us) if (uPos[u] >= 0) remove(u);
    for (let i = 0; i < us.length; i++) if (tos[i] >= 0) add(us[i], tos[i]);
    return touchedCost() + hard * W_HARD - before;
  };

  // ── 초안: 고정 수업을 놓고, 까다로운 덩어리부터 가장 덜 나쁜 자리에 ──
  for (let u = 0; u < U; u++) {
    if (!uFixed[u]) continue;
    const at = uPos[u];
    uPos[u] = -1;
    add(u, at);
  }
  const free: number[] = [];
  for (let u = 0; u < U; u++) if (!uFixed[u]) free.push(u);
  const weight = (u: number) => uRes[u].length * 10 + uLen[u] * 25 + rand();
  const order = free.map((u) => [u, weight(u)] as const).sort((a, b) => b[1] - a[1]);
  for (const [u] of order) {
    const starts = startsFor(uLen[u]);
    if (!starts.length) continue;
    let best = -1;
    let bestDelta = Infinity;
    const offset = Math.floor(rand() * starts.length);
    for (let i = 0; i < starts.length; i++) {
      const at = starts[(i + offset) % starts.length];
      const delta = applyMoves([u], [at]);
      remove(u);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = at;
      }
    }
    add(u, best);
  }

  // ── 담금질 ──
  const movable = free.filter((u) => uPos[u] >= 0);
  const classUnits = new Map<number, number[]>();
  for (const u of movable)
    for (const r of uRes[u])
      if (resKind[r] === 1) {
        let list = classUnits.get(r);
        if (!list) classUnits.set(r, (list = []));
        list.push(u);
      }

  let cost = hard * W_HARD + softTotal();
  let bestCost = cost;
  let bestHard = hard;
  let bestPos = uPos.slice();
  const T0 = 6;
  const T1 = 0.08;
  const started = Date.now();
  let temp = T0;
  let iterations = 0;
  let lastReport = started;

  const rebuildCells = () => {
    cellUnit.fill(-1);
    for (let u = 0; u < U; u++) {
      if (uPos[u] < 0) continue;
      for (const r of uRes[u]) for (let k = 0; k < uLen[u]; k++) cellUnit[r * S + uPos[u] + k] = u;
    }
  };

  // 켐페 사슬: 두 시간대 사이에서 서로 얽힌 수업들을 통째로 맞바꾼다.
  // 학급 시간표가 꽉 차 있어도 충돌을 만들지 않고 움직일 수 있다.
  const inChain = new Int32Array(U);
  let chainTick = 0;
  const chain: number[] = [];
  const chainTo: number[] = [];
  const buildChain = (u: number, s1: number, s2: number) => {
    chainTick++;
    chain.length = 0;
    chainTo.length = 0;
    chain.push(u);
    inChain[u] = chainTick;
    for (let i = 0; i < chain.length; i++) {
      const x = chain[i];
      const other = uPos[x] === s1 ? s2 : s1;
      chainTo.push(other);
      for (const r of uRes[x]) {
        const c = r * S + other;
        if (occ[c] === 0) continue;
        const y = cellUnit[c];
        if (occ[c] > 1 || y < 0) return false;
        if (inChain[y] === chainTick) continue;
        if (uFixed[y] || uLen[y] !== 1 || chain.length >= 60) return false;
        inChain[y] = chainTick;
        chain.push(y);
      }
    }
    return true;
  };

  if (movable.length > 0) {
    const us1 = [0];
    const to1 = [0];
    const us2 = [0, 0];
    const to2 = [0, 0];
    const back: number[] = [];
    while (bestCost > 0) {
      if ((iterations & 1023) === 0) {
        const now = Date.now();
        const ratio = (now - started) / opts.timeMs;
        if (ratio >= 1) break;
        temp = T0 * Math.pow(T1 / T0, ratio);
        if ((iterations & 65535) === 0) rebuildCells();
        if (opts.onProgress && now - lastReport > 250) {
          lastReport = now;
          opts.onProgress({ ratio, hard: bestHard, soft: bestCost - bestHard * W_HARD });
        }
      }
      iterations++;
      const u = movable[Math.floor(rand() * movable.length)];
      const from = uPos[u];
      const pick = rand();
      let delta: number;
      let undoUs: number[];
      let undoTo: number[];
      if (pick < 0.4) {
        if (uLen[u] !== 1) continue;
        const to = Math.floor(rand() * S);
        if (to === from || !buildChain(u, from, to)) continue;
        back.length = 0;
        for (const x of chain) back.push(uPos[x]);
        delta = applyMoves(chain, chainTo);
        undoUs = chain;
        undoTo = back;
      } else if (pick < 0.7) {
        const classes = uRes[u].filter((r) => resKind[r] === 1);
        const list = classes.length ? classUnits.get(classes[Math.floor(rand() * classes.length)]) : undefined;
        if (!list || list.length < 2) continue;
        const v = list[Math.floor(rand() * list.length)];
        if (v === u || uLen[v] !== uLen[u] || uLesson[v] === uLesson[u]) continue;
        const vFrom = uPos[v];
        us2[0] = u;
        us2[1] = v;
        to2[0] = vFrom;
        to2[1] = from;
        delta = applyMoves(us2, to2);
        to2[0] = from;
        to2[1] = vFrom;
        undoUs = us2;
        undoTo = to2;
      } else {
        const starts = startsFor(uLen[u]);
        const at = starts[Math.floor(rand() * starts.length)];
        if (at === from) continue;
        us1[0] = u;
        to1[0] = at;
        delta = applyMoves(us1, to1);
        to1[0] = from;
        undoUs = us1;
        undoTo = to1;
      }
      if (delta <= 0 || rand() < Math.exp(-delta / temp)) {
        cost += delta;
        if (cost < bestCost) {
          bestCost = cost;
          bestHard = hard;
          bestPos = uPos.slice();
        }
      } else {
        applyMoves(undoUs, undoTo);
      }
    }
  }

  // 가장 좋았던 상태로 되돌린다.
  for (let u = 0; u < U; u++) if (uPos[u] >= 0) remove(u);
  for (let u = 0; u < U; u++) if (bestPos[u] >= 0) add(u, bestPos[u]);

  // 끝내 겹치는 수업은 시간표에서 빼서 '미배치'로 돌려준다 (겹친 채로 넘기지 않는다).
  const badCells = (u: number) => {
    let n = 0;
    const at = uPos[u];
    for (const r of uRes[u])
      for (let k = 0; k < uLen[u]; k++) {
        const c = r * S + at + k;
        if (occ[c] > 1) n++;
        if (unavail[c]) n++;
      }
    return n;
  };
  for (;;) {
    let worst = -1;
    let worstN = 0;
    for (const u of free) {
      if (uPos[u] < 0) continue;
      const n = badCells(u);
      if (n > worstN) {
        worstN = n;
        worst = u;
      }
    }
    if (worst < 0) break;
    remove(worst);
  }

  const placed: SolveResult['placed'] = {};
  const unplaced: string[] = [];
  for (let u = 0; u < U; u++) {
    if (uPos[u] >= 0) placed[uId[u]] = { day: slotDay[uPos[u]], period: slotPer[uPos[u]] };
    else unplaced.push(uId[u]);
  }
  opts.onProgress?.({ ratio: 1, hard: 0, soft: softTotal() });
  return { placed, unplaced, soft: softTotal(), iterations };
}
