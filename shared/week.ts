// 날짜가 있는 "이번 주 시간표": 게시된 기본 시간표에 날짜별 변경(교체·이동·대강·결강)을 입힌 것.

import { buildIndex, lessonRooms, slotKey, startError } from './model.ts';
import type { EntityKind, Index, Unit } from './model.ts';
import { getSettings } from './types.ts';
import type { Change, Db, Settings } from './types.ts';

// ── 날짜 ──
const pad = (n: number) => String(n).padStart(2, '0');
export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
/** 그 날짜가 속한 주의 월요일. 주말이면 다음 주 월요일. */
export function mondayOf(iso: string): string {
  const d = fromISO(iso);
  const dow = d.getDay(); // 0 일 … 6 토
  const diff = dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return toISO(d);
}
export const shortDate = (iso: string) => {
  const d = fromISO(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
export const changeId = (unitId: string, date: string) => `${unitId}@${date}`;

/** 그 주에 실제로 열리는(또는 빠진) 수업 한 번 */
export interface Occ {
  key: string;
  unit: Unit;
  /** 원래 날짜·요일·교시 */
  date: string;
  origDay: number;
  origPeriod: number;
  /** 실제 요일·교시 */
  day: number;
  period: number;
  /** 강좌별 실제 교사 */
  teachers: (string | null)[];
  cancelled: boolean;
  moved: boolean;
  substituted: boolean;
  change: Change | null;
}

export interface Week {
  monday: string;
  settings: Settings;
  index: Index;
  occs: Occ[];
  /** `${kind}:${id}:${day}-${period}` → 그 시간의 수업 (결강 제외) */
  cells: Map<string, Occ[]>;
}

const cellKey = (kind: EntityKind, id: string, day: number, period: number) => `${kind}:${id}:${day}-${period}`;

export function occEntities(o: Occ): [EntityKind, string][] {
  const l = o.unit.lesson;
  return [
    ...l.classIds.map((id) => ['class', id] as [EntityKind, string]),
    ...[...new Set(o.teachers.filter((t): t is string => !!t))].map((id) => ['teacher', id] as [EntityKind, string]),
    ...lessonRooms(l).map((id) => ['room', id] as [EntityKind, string]),
  ];
}

/** pub 은 게시된 시간표(+ changes). 변경은 같은 주 안에서만 옮긴다고 본다. */
export function buildWeek(pub: Db, monday: string, extra: Change[] = [], without: string[] = []): Week {
  const settings = getSettings(pub);
  const index = buildIndex(pub);
  const changes: Record<string, Change> = { ...pub.changes };
  for (const id of without) delete changes[id];
  for (const c of extra) changes[c.id] = c;
  const occs: Occ[] = [];
  const cells = new Map<string, Occ[]>();
  for (const unit of index.units.values()) {
    const pl = unit.placement;
    if (!pl || pl.day >= settings.days.length) continue;
    const date = addDays(monday, pl.day);
    const ch = changes[changeId(unit.id, date)] ?? null;
    let day = pl.day;
    let period = pl.period;
    if (ch && !ch.cancelled) {
      const d = Math.round((fromISO(ch.toDate).getTime() - fromISO(monday).getTime()) / 86400000);
      if (d >= 0 && d < settings.days.length) {
        day = d;
        period = ch.toPeriod;
      }
    }
    const teachers = unit.lesson.parts.map((p, i) => ch?.teachers[String(i)] ?? p.teacherId);
    const occ: Occ = {
      key: changeId(unit.id, date),
      unit,
      date,
      origDay: pl.day,
      origPeriod: pl.period,
      day,
      period,
      teachers,
      cancelled: !!ch?.cancelled,
      moved: day !== pl.day || period !== pl.period,
      substituted: unit.lesson.parts.some((p, i) => teachers[i] !== p.teacherId),
      change: ch,
    };
    occs.push(occ);
    if (occ.cancelled) continue;
    for (const [kind, id] of occEntities(occ))
      for (let i = 0; i < unit.len; i++) {
        const k = cellKey(kind, id, day, period + i);
        let cell = cells.get(k);
        if (!cell) cells.set(k, (cell = []));
        cell.push(occ);
      }
  }
  return { monday, settings, index, occs, cells };
}

export function occsAt(week: Week, kind: EntityKind, id: string, day: number, period: number): Occ[] {
  return week.cells.get(cellKey(kind, id, day, period)) ?? [];
}

/** 한 학급·교사·교실(또는 학생)의 그 주 수업 전부 (결강 포함) */
export function occsOf(week: Week, kind: EntityKind, id: string): Occ[] {
  return week.occs.filter((o) =>
    kind === 'class'
      ? o.unit.lesson.classIds.includes(id)
      : kind === 'teacher'
        ? o.teachers.includes(id) || o.unit.lesson.parts.some((p) => p.teacherId === id)
        : o.unit.lesson.parts.some((p) => p.roomId === id),
  );
}

const KIND_LABEL: Record<EntityKind, string> = { class: '학급', teacher: '교사', room: '교실' };
const nameOf = (db: Db, kind: EntityKind, id: string) =>
  (kind === 'class' ? db.classes[id]?.name : kind === 'teacher' ? db.teachers[id]?.name : db.rooms[id]?.name) ?? '?';

/** 이 주에서 겹치는 곳을 찾는다. only 가 있으면 그 수업들이 얽힌 것만. */
export function weekProblems(pub: Db, week: Week, only?: Set<string>): string[] {
  const s = week.settings;
  const out = new Set<string>();
  for (const [key, cell] of week.cells) {
    if (cell.length < 2) continue;
    if (only && !cell.some((o) => only.has(o.key))) continue;
    const [kind, id, slot] = key.split(':') as [EntityKind, string, string];
    const [d, p] = slot.split('-').map(Number);
    out.add(`${KIND_LABEL[kind]} ${nameOf(pub, kind, id)}: ${s.days[d]} ${p}교시 겹침`);
  }
  for (const o of week.occs) {
    if (o.cancelled || (only && !only.has(o.key))) continue;
    const err = startError(s, o.day, o.period, o.unit.len);
    if (err) out.add(err);
    if (!o.moved && !o.substituted) continue;
    for (const t of o.teachers)
      for (let i = 0; i < o.unit.len; i++)
        if (t && pub.teachers[t]?.unavailable.includes(slotKey(o.day, o.period + i)))
          out.add(`${pub.teachers[t].name}: ${s.days[o.day]} ${o.period + i}교시는 수업 불가 시간`);
  }
  return [...out];
}

function makeChange(o: Occ, patch: Partial<Change>, groupId: string, now: number): Change {
  return {
    id: o.key,
    unitId: o.unit.id,
    date: o.date,
    toDate: o.change?.toDate ?? o.date,
    toPeriod: o.change?.toPeriod ?? o.origPeriod,
    cancelled: false,
    teachers: o.change?.teachers ?? {},
    note: o.change?.note ?? '',
    groupId,
    createdAt: now,
    ...patch,
  };
}

/** 두 수업의 시간을 맞바꾸는 변경 */
export function swapChanges(week: Week, a: Occ, b: Occ, groupId: string, now: number): Change[] {
  return [
    makeChange(a, { toDate: addDays(week.monday, b.day), toPeriod: b.period }, groupId, now),
    makeChange(b, { toDate: addDays(week.monday, a.day), toPeriod: a.period }, groupId, now),
  ];
}
/** 빈 시간으로 옮기는 변경 */
export function moveChange(week: Week, a: Occ, day: number, period: number, groupId: string, now: number): Change {
  return makeChange(a, { toDate: addDays(week.monday, day), toPeriod: period }, groupId, now);
}
/** 대강: 강좌 partIdx 의 교사를 바꾼다 */
export function substituteChange(a: Occ, partIdx: number, teacherId: string, groupId: string, now: number): Change {
  const teachers = { ...(a.change?.teachers ?? {}) };
  if (a.unit.lesson.parts[partIdx]?.teacherId === teacherId) delete teachers[String(partIdx)];
  else teachers[String(partIdx)] = teacherId;
  return makeChange(a, { teachers }, groupId, now);
}
export function cancelChange(a: Occ, groupId: string, now: number): Change {
  return makeChange(a, { cancelled: true }, groupId, now);
}

/** 변경을 적용했을 때 생기는 문제 (빈 배열이면 안전) */
export function tryChanges(pub: Db, monday: string, changes: Change[]): string[] {
  const week = buildWeek(pub, monday, changes);
  return weekProblems(pub, week, new Set(changes.map((c) => c.id)));
}

export interface SwapCandidate {
  other: Occ;
  changes: Change[];
}

/** a 와 시간을 맞바꿔도 아무도 겹치지 않는 수업들 (같은 학급을 가르치는 수업 가운데) */
export function swapCandidates(pub: Db, week: Week, a: Occ, now: number): SwapCandidate[] {
  const classes = new Set(a.unit.lesson.classIds);
  const out: SwapCandidate[] = [];
  for (const b of week.occs) {
    if (b.key === a.key || b.cancelled || b.unit.len !== a.unit.len) continue;
    if (b.unit.lesson.id === a.unit.lesson.id) continue;
    if (!b.unit.lesson.classIds.some((c) => classes.has(c))) continue;
    if (b.day === a.day && b.period === a.period) continue;
    const changes = swapChanges(week, a, b, 'candidate', now);
    if (tryChanges(pub, week.monday, changes).length === 0) out.push({ other: b, changes });
  }
  return out.sort((x, y) => x.other.day - y.other.day || x.other.period - y.other.period);
}

/** 그 시간에 수업이 없는 교사들. 같은 과목을 가르치는 교사를 앞에 둔다. */
export function freeTeachers(pub: Db, week: Week, o: Occ, partIdx: number): { id: string; name: string; same: boolean }[] {
  const subjectId = o.unit.lesson.parts[partIdx]?.subjectId;
  const teaches = new Set<string>();
  for (const l of Object.values(pub.lessons)) for (const p of l.parts) if (p.subjectId === subjectId && p.teacherId) teaches.add(p.teacherId);
  const out: { id: string; name: string; same: boolean }[] = [];
  for (const t of Object.values(pub.teachers)) {
    if (o.teachers.includes(t.id)) continue;
    let free = true;
    for (let i = 0; i < o.unit.len; i++) {
      if (occsAt(week, 'teacher', t.id, o.day, o.period + i).length) free = false;
      if (t.unavailable.includes(slotKey(o.day, o.period + i))) free = false;
    }
    if (free) out.push({ id: t.id, name: t.name, same: teaches.has(t.id) });
  }
  return out.sort((a, b) => Number(b.same) - Number(a.same) || a.name.localeCompare(b.name, 'ko'));
}

/** 변경 한 건을 사람이 읽는 문장으로 */
export function describeChange(pub: Db, index: Index, c: Change): string {
  const s = getSettings(pub);
  const unit = index.units.get(c.unitId);
  if (!unit || !unit.placement) return '(지금 시간표에 없는 수업)';
  const l = unit.lesson;
  const cls = l.classIds.length > 3 ? `${l.classIds.length}개 학급` : l.classIds.map((id) => pub.classes[id]?.name ?? '?').join('·');
  const subj = l.label || (pub.subjects[l.parts[0]?.subjectId]?.name ?? '?');
  const dow = (iso: string) => s.days[(fromISO(iso).getDay() + 6) % 7] ?? '';
  const from = `${shortDate(c.date)}(${dow(c.date)}) ${unit.placement.period}교시`;
  const head = `${cls} ${subj}`;
  if (c.cancelled) return `${head} — ${from} 결강`;
  const parts: string[] = [];
  if (c.toDate !== c.date || c.toPeriod !== unit.placement.period) parts.push(`${from} → ${shortDate(c.toDate)}(${dow(c.toDate)}) ${c.toPeriod}교시`);
  else parts.push(from);
  for (const [i, t] of Object.entries(c.teachers)) {
    const orig = l.parts[Number(i)]?.teacherId;
    parts.push(`${orig ? (pub.teachers[orig]?.name ?? '?') : '미정'} → ${pub.teachers[t]?.name ?? '?'} 대강`);
  }
  return `${head} — ${parts.join(', ')}`;
}
