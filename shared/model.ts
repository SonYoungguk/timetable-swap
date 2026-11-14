import { getSettings } from './types.ts';
import type { Db, Lesson, Placement, Settings } from './types.ts';

export type EntityKind = 'class' | 'teacher' | 'room';

export interface Unit {
  id: string;
  lesson: Lesson;
  idx: number;
  len: number;
  placement: Placement | null;
}

export interface Issue {
  message: string;
  target: { kind: EntityKind; id: string } | null;
  unitIds: string[];
}

export const unitId = (lessonId: string, idx: number) => `${lessonId}:${idx}`;
export const slotKey = (day: number, period: number) => `${day}-${period}`;
export const lessonHours = (l: Lesson) => l.blocks.reduce((a, b) => a + b, 0);

export function lessonTeachers(l: Lesson): string[] {
  return [...new Set(l.parts.map((p) => p.teacherId).filter((x): x is string => !!x))];
}
export function lessonRooms(l: Lesson): string[] {
  return [...new Set(l.parts.map((p) => p.roomId).filter((x): x is string => !!x))];
}
export function unitEntities(l: Lesson): [EntityKind, string][] {
  return [
    ...l.classIds.map((id) => ['class', id] as [EntityKind, string]),
    ...lessonTeachers(l).map((id) => ['teacher', id] as [EntityKind, string]),
    ...lessonRooms(l).map((id) => ['room', id] as [EntityKind, string]),
  ];
}

/** 해당 요일·교시에 길이 len 수업을 시작할 수 없으면 이유를 돌려준다. */
export function startError(s: Settings, day: number, period: number, len: number): string | null {
  const max = s.periodsPerDay[day] ?? 0;
  if (day < 0 || day >= s.days.length || period < 1 || period + len - 1 > max) return '교시 범위를 벗어남';
  if (len > 1 && period <= s.lunchAfter && period + len - 1 > s.lunchAfter) return '연강이 점심시간에 걸침';
  return null;
}

export interface Index {
  settings: Settings;
  units: Map<string, Unit>;
  /** `${kind}:${id}:${day}-${period}` → 그 시간에 놓인 수업 덩어리들 */
  occ: Map<string, Unit[]>;
  byEntity: Map<string, Unit[]>;
}

const occKey = (kind: EntityKind, id: string, day: number, period: number) => `${kind}:${id}:${day}-${period}`;

export function buildIndex(db: Db): Index {
  const settings = getSettings(db);
  const units = new Map<string, Unit>();
  const occ = new Map<string, Unit[]>();
  const byEntity = new Map<string, Unit[]>();
  for (const lesson of Object.values(db.lessons)) {
    const ents = unitEntities(lesson);
    lesson.blocks.forEach((len, idx) => {
      const id = unitId(lesson.id, idx);
      const placement = db.placements[id] ?? null;
      const unit: Unit = { id, lesson, idx, len, placement };
      units.set(id, unit);
      for (const [kind, eid] of ents) {
        const k = `${kind}:${eid}`;
        let list = byEntity.get(k);
        if (!list) byEntity.set(k, (list = []));
        list.push(unit);
        if (placement) {
          for (let i = 0; i < len; i++) {
            const ok = occKey(kind, eid, placement.day, placement.period + i);
            let cell = occ.get(ok);
            if (!cell) occ.set(ok, (cell = []));
            cell.push(unit);
          }
        }
      }
    });
  }
  return { settings, units, occ, byEntity };
}

export function unitsAt(index: Index, kind: EntityKind, id: string, day: number, period: number): Unit[] {
  return index.occ.get(occKey(kind, id, day, period)) ?? [];
}
export function unitsOf(index: Index, kind: EntityKind, id: string): Unit[] {
  return index.byEntity.get(`${kind}:${id}`) ?? [];
}

export function entityName(db: Db, kind: EntityKind, id: string): string {
  if (kind === 'class') return db.classes[id]?.name ?? '?';
  if (kind === 'teacher') return db.teachers[id]?.name ?? '?';
  return db.rooms[id]?.name ?? '?';
}

const KIND_LABEL: Record<EntityKind, string> = { class: '학급', teacher: '교사', room: '교실' };

/**
 * unit 을 (day, period) 에 놓으면 생기는 문제 목록. 빈 배열이면 놓을 수 있다.
 * ignore 에 든 수업 덩어리는 없는 것으로 본다 (자기 자신, 맞바꿀 상대).
 */
export function checkPlacement(
  db: Db,
  index: Index,
  unit: Unit,
  day: number,
  period: number,
  ignore: Set<string>,
): string[] {
  const err = startError(index.settings, day, period, unit.len);
  if (err) return [err];
  const reasons: string[] = [];
  for (const [kind, id] of unitEntities(unit.lesson)) {
    for (let i = 0; i < unit.len; i++) {
      const p = period + i;
      const others = unitsAt(index, kind, id, day, p).filter((u) => u.id !== unit.id && !ignore.has(u.id));
      if (others.length) reasons.push(`${KIND_LABEL[kind]} ${entityName(db, kind, id)} ${p}교시 겹침`);
      if (kind === 'teacher' && db.teachers[id]?.unavailable.includes(slotKey(day, p)))
        reasons.push(`${entityName(db, kind, id)} 교사 수업 불가 시간`);
    }
  }
  return [...new Set(reasons)];
}

export function describeLesson(db: Db, l: Lesson): string {
  if (l.label) return l.label;
  const subj = db.subjects[l.parts[0]?.subjectId]?.name ?? '?';
  const cls = l.classIds.map((c) => db.classes[c]?.name ?? '?').join('·');
  return `${cls} ${subj}`;
}

export interface Analysis {
  conflicts: Issue[];
  warnings: Issue[];
  conflictUnits: Set<string>;
  unplaced: number;
}

/** 전체 시간표 검사: 충돌(반드시 고쳐야 함)과 권장 사항 위반. */
export function analyze(db: Db, index: Index): Analysis {
  const s = index.settings;
  const conflicts: Issue[] = [];
  const warnings: Issue[] = [];
  const conflictUnits = new Set<string>();
  let unplaced = 0;
  const dayName = (d: number) => s.days[d] ?? '?';

  for (const [key, cell] of index.occ) {
    if (cell.length < 2) continue;
    const [kind, id, slot] = key.split(':') as [EntityKind, string, string];
    const [d, p] = slot.split('-').map(Number);
    cell.forEach((u) => conflictUnits.add(u.id));
    conflicts.push({
      message: `${KIND_LABEL[kind]} ${entityName(db, kind, id)}: ${dayName(d)} ${p}교시에 수업 ${cell.length}개 겹침`,
      target: { kind, id },
      unitIds: cell.map((u) => u.id),
    });
  }

  for (const u of index.units.values()) {
    const pl = u.placement;
    if (!pl) {
      unplaced++;
      continue;
    }
    const firstClass = u.lesson.classIds[0];
    const target = firstClass ? { kind: 'class' as EntityKind, id: firstClass } : null;
    const err = startError(s, pl.day, pl.period, u.len);
    if (err) {
      conflictUnits.add(u.id);
      conflicts.push({ message: `${describeLesson(db, u.lesson)}: ${err}`, target, unitIds: [u.id] });
    }
    for (const tid of lessonTeachers(u.lesson)) {
      for (let i = 0; i < u.len; i++) {
        if (db.teachers[tid]?.unavailable.includes(slotKey(pl.day, pl.period + i))) {
          conflictUnits.add(u.id);
          conflicts.push({
            message: `${db.teachers[tid].name}: ${dayName(pl.day)} ${pl.period + i}교시는 수업 불가 시간`,
            target: { kind: 'teacher', id: tid },
            unitIds: [u.id],
          });
        }
      }
    }
  }

  // 같은 수업이 하루에 두 번
  for (const lesson of Object.values(db.lessons)) {
    if (lesson.blocks.length < 2) continue;
    const perDay = new Map<number, string[]>();
    lesson.blocks.forEach((_, idx) => {
      const pl = db.placements[unitId(lesson.id, idx)];
      if (!pl) return;
      perDay.set(pl.day, [...(perDay.get(pl.day) ?? []), pl.id]);
    });
    for (const [d, ids] of perDay) {
      if (ids.length > 1)
        warnings.push({
          message: `${describeLesson(db, lesson)}: ${dayName(d)}요일에 ${ids.length}번 들어 있음`,
          target: lesson.classIds[0] ? { kind: 'class', id: lesson.classIds[0] } : null,
          unitIds: ids,
        });
    }
  }

  const busy = (kind: EntityKind, id: string, d: number, p: number) => unitsAt(index, kind, id, d, p).length > 0;

  for (const t of Object.values(db.teachers)) {
    for (let d = 0; d < s.days.length; d++) {
      let total = 0;
      let run = 0;
      let worst = 0;
      for (let p = 1; p <= s.periodsPerDay[d]; p++) {
        if (busy('teacher', t.id, d, p)) {
          total++;
          run++;
          worst = Math.max(worst, run);
        } else run = 0;
        if (p === s.lunchAfter) run = 0;
      }
      if (total > s.maxTeacherPerDay)
        warnings.push({
          message: `${t.name}: ${dayName(d)}요일 수업 ${total}시간 (권장 ${s.maxTeacherPerDay}시간 이하)`,
          target: { kind: 'teacher', id: t.id },
          unitIds: [],
        });
      if (worst > s.maxTeacherConsecutive)
        warnings.push({
          message: `${t.name}: ${dayName(d)}요일 ${worst}시간 연속 수업 (권장 ${s.maxTeacherConsecutive}시간 이하)`,
          target: { kind: 'teacher', id: t.id },
          unitIds: [],
        });
    }
  }

  for (const c of Object.values(db.classes)) {
    for (let d = 0; d < s.days.length; d++) {
      let last = 0;
      for (let p = 1; p <= s.periodsPerDay[d]; p++) if (busy('class', c.id, d, p)) last = p;
      const gaps: number[] = [];
      for (let p = 1; p < last; p++) if (!busy('class', c.id, d, p)) gaps.push(p);
      if (gaps.length)
        warnings.push({
          message: `${c.name}: ${dayName(d)}요일 ${gaps.join('·')}교시가 비어 있음 (공강)`,
          target: { kind: 'class', id: c.id },
          unitIds: [],
        });
    }
  }

  return { conflicts, warnings, conflictUnits, unplaced };
}

/** 삭제·수정으로 더는 맞지 않게 된 배치를 찾는다. */
export function stalePlacements(db: Db): string[] {
  const out: string[] = [];
  for (const pl of Object.values(db.placements)) {
    const lesson = db.lessons[pl.lessonId];
    if (!lesson || pl.idx >= lesson.blocks.length) out.push(pl.id);
  }
  return out;
}

export function sortedClasses(db: Db) {
  return Object.values(db.classes).sort((a, b) => a.grade - b.grade || a.num - b.num);
}
export function sortedByName<T extends { name: string }>(rec: Record<string, T>): T[] {
  return Object.values(rec).sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
}
