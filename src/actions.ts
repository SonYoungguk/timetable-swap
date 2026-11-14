// 여러 자료를 함께 고쳐야 하는 편집 동작 모음.
import { demoDb } from '../shared/demo.ts';
import { COLLECTIONS } from '../shared/types.ts';
import type { Db, Lesson, Op, Placement } from '../shared/types.ts';
import { useStore } from './store.ts';

const state = () => useStore.getState();
const put = <T extends { id: string }>(collection: Op['collection'], doc: T): Op => ({
  op: 'put',
  collection,
  doc: doc as unknown as { id: string } & Record<string, unknown>,
});

const placementsOf = (db: Db, lessonId: string) => Object.values(db.placements).filter((p) => p.lessonId === lessonId);

export function saveLesson(lesson: Lesson) {
  const { db, mutate } = state();
  const old = db.lessons[lesson.id];
  const ops: Op[] = [put('lessons', lesson)];
  // 시수 구성이 바뀌면 그 수업의 배치는 다시 해야 한다.
  if (old && old.blocks.join() !== lesson.blocks.join())
    for (const p of placementsOf(db, lesson.id)) ops.push({ op: 'del', collection: 'placements', id: p.id });
  mutate(ops);
}

export function addLessons(lessons: Lesson[]) {
  state().mutate(lessons.map((l) => put('lessons', l)));
}

export function deleteLesson(id: string) {
  const { db, mutate } = state();
  mutate([
    ...placementsOf(db, id).map((p): Op => ({ op: 'del', collection: 'placements', id: p.id })),
    { op: 'del', collection: 'lessons', id },
  ]);
}

/** 교사·교실을 지우면 수업에서 해당 칸만 비운다. */
export function deleteTeacherOrRoom(kind: 'teachers' | 'rooms', id: string) {
  const { db, mutate } = state();
  const field = kind === 'teachers' ? 'teacherId' : 'roomId';
  const ops: Op[] = [];
  for (const l of Object.values(db.lessons)) {
    if (!l.parts.some((p) => p[field] === id)) continue;
    ops.push(put('lessons', { ...l, parts: l.parts.map((p) => (p[field] === id ? { ...p, [field]: null } : p)) }));
  }
  if (kind === 'rooms')
    for (const t of Object.values(db.teachers)) if (t.roomId === id) ops.push(put('teachers', { ...t, roomId: null }));
  ops.push({ op: 'del', collection: kind, id });
  mutate(ops);
}

export function lessonsUsing(db: Db, kind: 'subjects' | 'classes', id: string): number {
  return Object.values(db.lessons).filter((l) =>
    kind === 'subjects' ? l.parts.some((p) => p.subjectId === id) : l.classIds.includes(id),
  ).length;
}

export function setPlacement(unit: { id: string; lesson: Lesson; idx: number }, day: number, period: number, pinned = false): Op {
  const doc: Placement = { id: unit.id, lessonId: unit.lesson.id, idx: unit.idx, day, period, pinned };
  return put('placements', doc);
}

export function clearPlacements(keepPinned: boolean) {
  const { db, mutate } = state();
  mutate(
    Object.values(db.placements)
      .filter((p) => !(keepPinned && p.pinned))
      .map((p): Op => ({ op: 'del', collection: 'placements', id: p.id })),
  );
}

function wipeOps(db: Db): Op[] {
  const ops: Op[] = [];
  for (const c of COLLECTIONS) for (const id of Object.keys(db[c])) ops.push({ op: 'del', collection: c, id });
  return ops;
}

export function clearAll() {
  const { db, mutate } = state();
  mutate(wipeOps(db));
}

export function loadDemo() {
  const { db, mutate } = state();
  const demo = demoDb();
  const ops = wipeOps(db);
  for (const c of COLLECTIONS) for (const doc of Object.values(demo[c])) ops.push(put(c, doc));
  mutate(ops);
}

/** 파일에서 읽은 자료로 전체를 바꾼다. */
export function importDb(data: Partial<Db>) {
  const { db, mutate } = state();
  const ops = wipeOps(db);
  for (const c of COLLECTIONS) for (const doc of Object.values(data[c] ?? {})) if (doc && typeof doc.id === 'string') ops.push(put(c, doc));
  mutate(ops);
}
