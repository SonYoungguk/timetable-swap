// 교과교실제: 수강 인원 계산, 교실 자동 배정, 교실 사용 현황.

import { buildIndex, lessonHours, unitsAt } from './model.ts';
import { getSettings } from './types.ts';
import type { Db, Lesson } from './types.ts';

/** 강좌 수강 인원. 학생 자료가 없으면 null. */
export function partSize(db: Db, lesson: Lesson, partIdx: number): number | null {
  const students = Object.values(db.students).filter((s) => lesson.classIds.includes(s.classId));
  if (!students.length) return null;
  if (lesson.parts.length === 1) return students.length;
  return students.filter((s) => s.choices[lesson.id] === partIdx).length;
}

export interface RoomIssue {
  lessonId: string;
  message: string;
}

/** 교실 종류가 맞지 않거나 인원이 넘치는 수업 */
export function roomIssues(db: Db, describe: (l: Lesson, partIdx: number) => string): RoomIssue[] {
  const out: RoomIssue[] = [];
  for (const l of Object.values(db.lessons))
    l.parts.forEach((p, i) => {
      const subj = db.subjects[p.subjectId];
      const room = p.roomId ? db.rooms[p.roomId] : null;
      const who = describe(l, i);
      if (subj?.roomKind && !room) out.push({ lessonId: l.id, message: `${who}: ${subj.roomKind}이(가) 필요한데 교실이 정해지지 않음` });
      else if (subj?.roomKind && room && room.kind !== subj.roomKind)
        out.push({ lessonId: l.id, message: `${who}: ${subj.roomKind}이(가) 필요한데 ${room.name}(${room.kind || '종류 없음'}) 배정` });
      const size = partSize(db, l, i);
      if (room?.capacity && size !== null && size > room.capacity)
        out.push({ lessonId: l.id, message: `${who}: 수강 ${size}명 > ${room.name} 수용 ${room.capacity}명` });
    });
  return out;
}

export interface AssignResult {
  lessons: Lesson[];
  assigned: number;
  failed: number;
}

/** 교실이 비어 있는 강좌에 교사 전용 교실을 넣는다. */
export function applyTeacherRooms(db: Db): AssignResult {
  const lessons: Lesson[] = [];
  let assigned = 0;
  for (const l of Object.values(db.lessons)) {
    let changed = false;
    const parts = l.parts.map((p) => {
      const home = p.teacherId ? db.teachers[p.teacherId]?.roomId : null;
      if (p.roomId || !home || !db.rooms[home]) return p;
      changed = true;
      assigned++;
      return { ...p, roomId: home };
    });
    if (changed) lessons.push({ ...l, parts });
  }
  return { lessons, assigned, failed: 0 };
}

/**
 * 교실 종류가 정해진 과목인데 교실이 비어 있는 강좌에, 그 종류의 교실 가운데
 * 수업 시간에 비어 있고(이미 편성된 경우) 인원이 들어가며 덜 쓰이는 곳을 배정한다.
 */
export function autoAssignRooms(db: Db): AssignResult {
  const s = getSettings(db);
  const index = buildIndex(db);
  // 교실별 사용 칸: 이미 편성된 시간 + 이번에 새로 배정하는 수업의 시간
  const busy = new Map<string, Set<string>>();
  const load = new Map<string, number>();
  for (const r of Object.values(db.rooms)) {
    const set = new Set<string>();
    for (let d = 0; d < s.days.length; d++)
      for (let p = 1; p <= s.periodsPerDay[d]; p++) if (unitsAt(index, 'room', r.id, d, p).length) set.add(`${d}-${p}`);
    busy.set(r.id, set);
    load.set(r.id, 0);
  }
  for (const l of Object.values(db.lessons)) for (const p of l.parts) if (p.roomId) load.set(p.roomId, (load.get(p.roomId) ?? 0) + lessonHours(l));

  const slotsOf = (l: Lesson) => {
    const out: string[] = [];
    l.blocks.forEach((len, idx) => {
      const pl = db.placements[`${l.id}:${idx}`];
      if (pl) for (let i = 0; i < len; i++) out.push(`${pl.day}-${pl.period + i}`);
    });
    return out;
  };

  const lessons: Lesson[] = [];
  let assigned = 0;
  let failed = 0;
  // 시수가 많은 수업부터
  const todo = Object.values(db.lessons).sort((a, b) => lessonHours(b) - lessonHours(a));
  for (const l of todo) {
    let changed = false;
    const slots = slotsOf(l);
    const taken = new Set(l.parts.map((p) => p.roomId).filter(Boolean));
    const parts = l.parts.map((p, i) => {
      const kind = db.subjects[p.subjectId]?.roomKind;
      if (p.roomId || !kind) return p;
      const size = partSize(db, l, i);
      const pick = Object.values(db.rooms)
        .filter((r) => r.kind === kind && !taken.has(r.id))
        .filter((r) => !r.capacity || size === null || size <= r.capacity)
        .filter((r) => slots.every((k) => !busy.get(r.id)!.has(k)))
        .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
      if (!pick) {
        failed++;
        return p;
      }
      slots.forEach((k) => busy.get(pick.id)!.add(k));
      load.set(pick.id, (load.get(pick.id) ?? 0) + lessonHours(l));
      taken.add(pick.id);
      changed = true;
      assigned++;
      return { ...p, roomId: pick.id };
    });
    if (changed) lessons.push({ ...l, parts });
  }
  return { lessons, assigned, failed };
}

export interface RoomUsage {
  roomId: string;
  /** 수업이 배정된 주당 시수 (편성 여부와 무관) */
  hours: number;
  /** 시간표에 실제로 놓인 칸 수 */
  placed: number;
  total: number;
}

export function roomUsage(db: Db): RoomUsage[] {
  const s = getSettings(db);
  const index = buildIndex(db);
  const total = s.periodsPerDay.reduce((a, b) => a + b, 0);
  return Object.values(db.rooms).map((r) => {
    let placed = 0;
    for (let d = 0; d < s.days.length; d++)
      for (let p = 1; p <= s.periodsPerDay[d]; p++) if (unitsAt(index, 'room', r.id, d, p).length) placed++;
    let hours = 0;
    for (const l of Object.values(db.lessons)) if (l.parts.some((p) => p.roomId === r.id)) hours += lessonHours(l);
    return { roomId: r.id, hours, placed, total };
  });
}
