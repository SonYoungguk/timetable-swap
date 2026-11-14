import type { ReactNode } from 'react';
import { unitsOf } from '../shared/model.ts';
import type { EntityKind, Index, Unit } from '../shared/model.ts';
import { sortedByName, sortedClasses } from '../shared/model.ts';
import type { Db, Lesson } from '../shared/types.ts';

export const KIND_LABEL: Record<EntityKind, string> = { class: '학급', teacher: '교사', room: '교실' };

export function entitiesOf(db: Db, kind: EntityKind): { id: string; name: string }[] {
  if (kind === 'class') return sortedClasses(db);
  if (kind === 'teacher') return sortedByName(db.teachers);
  return sortedByName(db.rooms);
}

/** "2-1·2-2·…" 대신 "2학년", "전체" 처럼 줄여 쓴다. */
export function classesLabel(db: Db, classIds: string[]): string {
  const all = sortedClasses(db);
  if (classIds.length > 1 && classIds.length === all.length) return '전체';
  const set = new Set(classIds);
  const grades = [...new Set(all.map((c) => c.grade))];
  const parts: string[] = [];
  for (const g of grades) {
    const inGrade = all.filter((c) => c.grade === g);
    const picked = inGrade.filter((c) => set.has(c.id));
    if (picked.length > 1 && picked.length === inGrade.length) parts.push(`${g}학년`);
    else parts.push(...picked.map((c) => c.name));
  }
  return parts.join('·') || '(학급 없음)';
}

export interface CardInfo {
  title: string;
  lines: string[];
  color: string;
}

/** 보는 관점(학급·교사·교실)에 맞춰 수업 카드에 쓸 내용을 고른다. */
export function cardInfo(db: Db, lesson: Lesson, kind: EntityKind, id: string): CardInfo {
  const parts =
    kind === 'teacher'
      ? lesson.parts.filter((p) => p.teacherId === id)
      : kind === 'room'
        ? lesson.parts.filter((p) => p.roomId === id)
        : lesson.parts;
  const shown = parts.length ? parts : lesson.parts;
  const first = shown[0];
  const subj = (sid: string) => db.subjects[sid];
  const multi = shown.length > 1;
  const title = multi ? lesson.label || '선택과목' : (subj(first?.subjectId)?.short ?? '?');
  const color = multi ? '#eceff4' : (subj(first?.subjectId)?.color ?? '#eceff4');
  const lines: string[] = [];
  if (multi) lines.push(`${shown.length}개 강좌`);
  else {
    if (kind !== 'class') lines.push(classesLabel(db, lesson.classIds));
    if (kind !== 'teacher' && first?.teacherId) lines.push(db.teachers[first.teacherId]?.name ?? '');
    if (kind !== 'room' && first?.roomId) lines.push(db.rooms[first.roomId]?.name ?? '');
  }
  return { title, lines: lines.filter(Boolean), color };
}

export function lessonTooltip(db: Db, lesson: Lesson): string {
  const head = `${lesson.label ? lesson.label + ' · ' : ''}${classesLabel(db, lesson.classIds)}`;
  const rows = lesson.parts.map(
    (p) =>
      `${db.subjects[p.subjectId]?.name ?? '?'} / ${p.teacherId ? (db.teachers[p.teacherId]?.name ?? '?') : '교사 미정'}${p.roomId ? ' / ' + (db.rooms[p.roomId]?.name ?? '?') : ''}`,
  );
  return [head, ...rows].join('\n');
}

export function unplacedUnits(index: Index, kind: EntityKind, id: string): Unit[] {
  return unitsOf(index, kind, id).filter((u) => !u.placement);
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.wide ? 'wide' : ''}`} role="dialog" aria-label={props.title}>
        <div className="modal-head">
          <h3>{props.title}</h3>
          <button className="ghost" onClick={props.onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}
