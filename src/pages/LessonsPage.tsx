import { useState } from 'react';
import { lessonHours, sortedByName, sortedClasses } from '../../shared/model.ts';
import { getSettings } from '../../shared/types.ts';
import type { Lesson, LessonPart } from '../../shared/types.ts';
import { addLessons, deleteLesson, saveLesson } from '../actions.ts';
import { newId, useStore } from '../store.ts';
import { Modal, classesLabel } from '../ui.tsx';

const blocksText = (blocks: number[]) => {
  const doubles = blocks.filter((b) => b > 1).length;
  const total = blocks.reduce((a, b) => a + b, 0);
  return doubles ? `${total}시간 (연강 ${doubles}회)` : `${total}시간`;
};

function PartRow(props: { part: LessonPart; onChange: (p: LessonPart) => void; onRemove?: () => void }) {
  const db = useStore((s) => s.db);
  const { part } = props;
  return (
    <div className="part-row">
      <select value={part.subjectId} onChange={(e) => props.onChange({ ...part, subjectId: e.target.value })}>
        <option value="">과목 선택</option>
        {sortedByName(db.subjects).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select value={part.teacherId ?? ''} onChange={(e) => props.onChange({ ...part, teacherId: e.target.value || null })}>
        <option value="">교사 미정</option>
        {sortedByName(db.teachers).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <select value={part.roomId ?? ''} onChange={(e) => props.onChange({ ...part, roomId: e.target.value || null })}>
        <option value="">학급 교실</option>
        {sortedByName(db.rooms).map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      {props.onRemove && (
        <button className="ghost danger" onClick={props.onRemove} aria-label="강좌 삭제">
          ✕
        </button>
      )}
    </div>
  );
}

function LessonEditor(props: { lesson: Lesson | null; defaultClass: string; onClose: () => void }) {
  const db = useStore((s) => s.db);
  const editing = props.lesson;
  const [classIds, setClassIds] = useState<string[]>(editing?.classIds ?? (props.defaultClass ? [props.defaultClass] : []));
  const [parts, setParts] = useState<LessonPart[]>(editing?.parts ?? [{ subjectId: '', teacherId: null, roomId: null }]);
  const [label, setLabel] = useState(editing?.label ?? '');
  const [hours, setHours] = useState(editing ? lessonHours(editing) : 2);
  const [doubles, setDoubles] = useState(editing ? editing.blocks.filter((b) => b === 2).length : 0);
  const [together, setTogether] = useState(editing ? true : false);
  const classes = sortedClasses(db);
  const grades = [...new Set(classes.map((c) => c.grade))];
  const multiPart = parts.length > 1;
  const asOne = editing ? true : together || multiPart || classIds.length < 2;

  const toggle = (ids: string[]) => {
    const allOn = ids.every((id) => classIds.includes(id));
    setClassIds(allOn ? classIds.filter((id) => !ids.includes(id)) : [...new Set([...classIds, ...ids])]);
  };

  const maxDoubles = Math.floor(hours / 2);
  const d = Math.min(doubles, maxDoubles);
  const blocks = [...Array.from({ length: d }, () => 2), ...Array.from({ length: hours - d * 2 }, () => 1)];
  const problem = !classIds.length
    ? '학급을 하나 이상 고르세요.'
    : parts.some((p) => !p.subjectId)
      ? '과목을 고르세요.'
      : hours < 1
        ? '주당 시수를 넣으세요.'
        : null;

  const save = () => {
    const ordered = classes.filter((c) => classIds.includes(c.id)).map((c) => c.id);
    if (editing) saveLesson({ ...editing, classIds: ordered, parts, blocks, label: label.trim() });
    else if (asOne) addLessons([{ id: newId(), classIds: ordered, parts, blocks, label: label.trim() }]);
    else addLessons(ordered.map((c) => ({ id: newId(), classIds: [c], parts, blocks, label: '' })));
    props.onClose();
  };

  return (
    <Modal title={editing ? '수업 편집' : '수업 추가'} onClose={props.onClose} wide>
      <div className="form">
        <div>
          <div className="label">대상 학급</div>
          {grades.map((g) => {
            const inGrade = classes.filter((c) => c.grade === g);
            return (
              <div className="class-pick" key={g}>
                <button className="grade" onClick={() => toggle(inGrade.map((c) => c.id))}>
                  {g}학년 전체
                </button>
                {inGrade.map((c) => (
                  <label key={c.id} className={`chip ${classIds.includes(c.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={classIds.includes(c.id)} onChange={() => toggle([c.id])} />
                    {c.name}
                  </label>
                ))}
              </div>
            );
          })}
          {!classes.length && <p className="muted">기초 자료에서 학급을 먼저 만들어 주세요.</p>}
        </div>

        {!editing && classIds.length > 1 && !multiPart && (
          <div>
            <label className="radio">
              <input type="radio" checked={!together} onChange={() => setTogether(false)} />
              <span>
                <b>학급마다 따로 수업</b>
                <small>고른 {classIds.length}개 학급에 같은 수업을 하나씩 만듭니다. 교사는 만든 뒤 목록에서 반별로 바꿀 수 있습니다.</small>
              </span>
            </label>
            <label className="radio">
              <input type="radio" checked={together} onChange={() => setTogether(true)} />
              <span>
                <b>함께 수업 (합반)</b>
                <small>고른 학급이 같은 시간에 한 수업을 듣습니다.</small>
              </span>
            </label>
          </div>
        )}

        <div>
          <div className="label">강좌 (과목 · 교사 · 교실)</div>
          {parts.map((p, i) => (
            <PartRow
              key={i}
              part={p}
              onChange={(np) => setParts(parts.map((x, j) => (j === i ? np : x)))}
              onRemove={parts.length > 1 ? () => setParts(parts.filter((_, j) => j !== i)) : undefined}
            />
          ))}
          <button onClick={() => setParts([...parts, { subjectId: '', teacherId: null, roomId: null }])}>+ 같은 시간에 열리는 강좌 추가</button>
          <small className="muted block">
            선택과목처럼 학생들이 흩어져 듣는 수업은 강좌를 여러 개 넣으세요. 고른 학급 전체가 그 시간에 이 강좌들로 나뉘어 이동합니다.
          </small>
        </div>

        {multiPart && (
          <label>
            묶음 이름
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예) 2학년 선택A" />
          </label>
        )}

        <div className="row">
          <label className="inline">
            주당
            <input type="number" min={1} max={20} value={hours} onChange={(e) => setHours(Math.max(0, Math.round(Number(e.target.value))))} style={{ width: 60 }} />
            시간
          </label>
          <label className="inline">
            그중 연강(2시간 붙여서)
            <input type="number" min={0} max={maxDoubles} value={d} onChange={(e) => setDoubles(Math.max(0, Math.round(Number(e.target.value))))} style={{ width: 60 }} />
            회
          </label>
        </div>

        {editing && editing.blocks.join() !== blocks.join() && <p className="warn">시수 구성을 바꾸면 이 수업은 시간표에서 빠져 다시 배치해야 합니다.</p>}
        <div className="actions">
          {problem && <span className="warn">{problem}</span>}
          <button onClick={props.onClose}>취소</button>
          <button className="primary" disabled={!!problem} onClick={save}>
            {editing ? '저장' : asOne ? '수업 추가' : `수업 ${classIds.length}개 추가`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function LessonsPage() {
  const db = useStore((s) => s.db);
  const [classFilter, setClassFilter] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [editor, setEditor] = useState<{ lesson: Lesson | null } | null>(null);
  const s = getSettings(db);
  const slots = s.periodsPerDay.reduce((a, b) => a + b, 0);
  const classes = sortedClasses(db);
  const order = new Map(classes.map((c, i) => [c.id, i]));

  const hoursByClass = new Map<string, number>();
  for (const l of Object.values(db.lessons)) for (const c of l.classIds) hoursByClass.set(c, (hoursByClass.get(c) ?? 0) + lessonHours(l));

  const subjName = (l: Lesson) => db.subjects[l.parts[0]?.subjectId]?.name ?? '';
  const lessons = Object.values(db.lessons)
    .filter((l) => !classFilter || l.classIds.includes(classFilter))
    .filter((l) => !teacherFilter || l.parts.some((p) => (teacherFilter === '-' ? !p.teacherId : p.teacherId === teacherFilter)))
    .sort(
      (a, b) =>
        (order.get(a.classIds[0]) ?? 0) - (order.get(b.classIds[0]) ?? 0) ||
        a.classIds.length - b.classIds.length ||
        subjName(a).localeCompare(subjName(b), 'ko'),
    );
  const missingTeacher = Object.values(db.lessons).filter((l) => l.parts.some((p) => !p.teacherId)).length;

  return (
    <div className="page">
      <div className="toolbar">
        <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
          <option value="">모든 학급</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={teacherFilter} onChange={(e) => setTeacherFilter(e.target.value)}>
          <option value="">모든 교사</option>
          <option value="-">교사 미정 ({missingTeacher})</option>
          {sortedByName(db.teachers).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="muted">수업 {lessons.length}개</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setEditor({ lesson: null })}>
          + 수업 추가
        </button>
      </div>

      <div className="panel">
        <div className="label">
          학급별 주당 시수 <small className="muted">— 한 주 {slots}칸 기준. 누르면 그 학급 수업만 봅니다.</small>
        </div>
        <div className="chips">
          {classes.map((c) => {
            const h = hoursByClass.get(c.id) ?? 0;
            return (
              <button
                key={c.id}
                className={`chip ${h === slots ? 'full' : h > slots ? 'over' : 'under'} ${classFilter === c.id ? 'on' : ''}`}
                onClick={() => setClassFilter(classFilter === c.id ? '' : c.id)}
                title={h > slots ? '시수가 한 주 칸 수보다 많아 다 넣을 수 없습니다' : h < slots ? `${slots - h}시간 비어 있음` : '꽉 참'}
              >
                {c.name} <b>{h}</b>/{slots}
              </button>
            );
          })}
        </div>

        <table className="data lessons">
          <thead>
            <tr>
              <th>학급</th>
              <th>과목</th>
              <th>교사</th>
              <th>교실</th>
              <th>주당 시수</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lessons.map((l) => {
              const single = l.parts.length === 1;
              const p = l.parts[0];
              return (
                <tr key={l.id}>
                  <td>{classesLabel(db, l.classIds)}</td>
                  <td>
                    {single ? (
                      (db.subjects[p.subjectId]?.name ?? '?')
                    ) : (
                      <>
                        <b>{l.label || '선택과목 묶음'}</b>
                        <div className="sub">{l.parts.map((x) => db.subjects[x.subjectId]?.name ?? '?').join(' · ')}</div>
                      </>
                    )}
                  </td>
                  <td>
                    {single ? (
                      <select
                        className={p.teacherId ? '' : 'missing'}
                        value={p.teacherId ?? ''}
                        onChange={(e) => saveLesson({ ...l, parts: [{ ...p, teacherId: e.target.value || null }] })}
                      >
                        <option value="">교사 미정</option>
                        {sortedByName(db.teachers).map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="sub">{l.parts.map((x) => (x.teacherId ? (db.teachers[x.teacherId]?.name ?? '?') : '미정')).join(' · ')}</div>
                    )}
                  </td>
                  <td>
                    {single ? (
                      <select value={p.roomId ?? ''} onChange={(e) => saveLesson({ ...l, parts: [{ ...p, roomId: e.target.value || null }] })}>
                        <option value="">학급 교실</option>
                        {sortedByName(db.rooms).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="sub">{l.parts.map((x) => (x.roomId ? (db.rooms[x.roomId]?.name ?? '?') : '-')).join(' · ')}</div>
                    )}
                  </td>
                  <td>{blocksText(l.blocks)}</td>
                  <td className="nowrap">
                    <button onClick={() => setEditor({ lesson: l })}>편집</button>
                    <button className="ghost danger" onClick={() => confirm('이 수업을 지울까요? 시간표에서도 빠집니다.') && deleteLesson(l.id)}>
                      삭제
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!lessons.length && <div className="empty">수업이 없습니다. 오른쪽 위 <b>+ 수업 추가</b>로 만들어 주세요.</div>}
      </div>
      {editor && <LessonEditor lesson={editor.lesson} defaultClass={classFilter} onClose={() => setEditor(null)} />}
    </div>
  );
}
