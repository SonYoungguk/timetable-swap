import { useState } from 'react';
import { sortedClasses } from '../../shared/model.ts';
import { partSize } from '../../shared/rooms.ts';
import type { Lesson, Op, Student } from '../../shared/types.ts';
import { newId, useStore } from '../store.ts';
import { Modal, classesLabel } from '../ui.tsx';
import { TextCell } from './SetupPage.tsx';

const put = (s: Student): Op => ({ op: 'put', collection: 'students', doc: s as unknown as { id: string } & Record<string, unknown> });

function Roster(props: { lesson: Lesson; partIdx: number; onClose: () => void }) {
  const db = useStore((s) => s.db);
  const { lesson, partIdx } = props;
  const part = lesson.parts[partIdx];
  const classes = sortedClasses(db);
  const order = new Map(classes.map((c, i) => [c.id, i]));
  const list = Object.values(db.students)
    .filter((s) => lesson.classIds.includes(s.classId) && s.choices[lesson.id] === partIdx)
    .sort((a, b) => (order.get(a.classId) ?? 0) - (order.get(b.classId) ?? 0) || a.num - b.num);
  return (
    <Modal title={`${lesson.label} — ${db.subjects[part.subjectId]?.name ?? '?'} 수강 명단`} onClose={props.onClose}>
      <p className="muted">
        {part.teacherId ? db.teachers[part.teacherId]?.name : '교사 미정'} · {part.roomId ? db.rooms[part.roomId]?.name : '교실 미정'} · {list.length}명
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>학급</th>
            <th>번호</th>
            <th>이름</th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td>{db.classes[s.classId]?.name}</td>
              <td>{s.num}</td>
              <td>{s.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions no-print">
        <button onClick={() => window.print()}>인쇄</button>
        <button className="primary" onClick={props.onClose}>
          닫기
        </button>
      </div>
    </Modal>
  );
}

export function StudentsPage() {
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const classes = sortedClasses(db);
  const [classId, setClassId] = useState('');
  const [text, setText] = useState('');
  const [roster, setRoster] = useState<{ lesson: Lesson; partIdx: number } | null>(null);
  const cid = classes.some((c) => c.id === classId) ? classId : (classes[0]?.id ?? '');
  const students = Object.values(db.students)
    .filter((s) => s.classId === cid)
    .sort((a, b) => a.num - b.num);
  const bands = Object.values(db.lessons)
    .filter((l) => l.parts.length > 1 && l.classIds.includes(cid))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  const allBands = Object.values(db.lessons)
    .filter((l) => l.parts.length > 1)
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));

  const rows = text
    .split('\n')
    .map((l) => l.split(/\t|,/).map((x) => x.trim()))
    .filter((r) => r[0]);
  const addStudents = () => {
    let next = Math.max(0, ...students.map((s) => s.num));
    const ops = rows.map((r) => {
      // "번호, 이름" 또는 "이름" 만
      const hasNum = r.length > 1 && /^\d+$/.test(r[0]);
      const num = hasNum ? Number(r[0]) : ++next;
      if (hasNum) next = Math.max(next, num);
      return put({ id: newId(), classId: cid, num, name: hasNum ? r[1] : r[0], choices: {} });
    });
    mutate(ops);
    setText('');
  };
  const missing = students.filter((s) => bands.some((b) => s.choices[b.id] === undefined)).length;

  if (!classes.length)
    return (
      <div className="page">
        <div className="empty">기초 자료에서 학급을 먼저 만들어 주세요.</div>
      </div>
    );

  return (
    <div className="page">
      <div className="toolbar">
        <select value={cid} onChange={(e) => setClassId(e.target.value)}>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="muted">
          학생 {students.length}명{bands.length > 0 && missing > 0 && <b className="warn"> · 수강 강좌를 고르지 않은 학생 {missing}명</b>}
        </span>
      </div>

      <div className="panel">
        <div className="bulk">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={'학생을 한 줄에 한 명씩. 엑셀에서 "번호, 이름" 두 열을 복사해 붙여넣거나 이름만 넣으세요.\n예) 1, 김민준'}
          />
          <button className="primary" disabled={!rows.length} onClick={addStudents}>
            학생 추가 {rows.length > 0 && `(${rows.length})`}
          </button>
        </div>
        {!bands.length && students.length > 0 && (
          <p className="muted">이 학급에는 선택과목 묶음이 없습니다. 수업 배정에서 강좌가 여러 개인 수업을 만들면 여기서 학생별 수강 강좌를 고를 수 있습니다.</p>
        )}
        <table className="data">
          <thead>
            <tr>
              <th>번호</th>
              <th>이름</th>
              {bands.map((b) => (
                <th key={b.id}>{b.label || '선택과목'}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <td>
                  <TextCell type="number" width={60} value={String(s.num)} onCommit={(v) => Number(v) > 0 && mutate([put({ ...s, num: Math.round(Number(v)) })])} />
                </td>
                <td>
                  <TextCell value={s.name} width={110} onCommit={(v) => mutate([put({ ...s, name: v.trim() })])} />
                </td>
                {bands.map((b) => (
                  <td key={b.id}>
                    <select
                      className={s.choices[b.id] === undefined ? 'missing' : ''}
                      value={s.choices[b.id] ?? ''}
                      onChange={(e) => {
                        const choices = { ...s.choices };
                        if (e.target.value === '') delete choices[b.id];
                        else choices[b.id] = Number(e.target.value);
                        mutate([put({ ...s, choices })]);
                      }}
                    >
                      <option value="">선택 안 함</option>
                      {b.parts.map((p, i) => (
                        <option key={i} value={i}>
                          {db.subjects[p.subjectId]?.name ?? '?'}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
                <td>
                  <button className="ghost danger" onClick={() => mutate([{ op: 'del', collection: 'students', id: s.id }])}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!students.length && <div className="empty">이 학급에 등록된 학생이 없습니다.</div>}
      </div>

      {allBands.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="label">
            강좌별 수강 인원 <small className="muted">— 강좌를 누르면 명단이 나옵니다. 교실 수용 인원을 넘으면 빨갛게 표시됩니다.</small>
          </div>
          {allBands.map((b) => (
            <div className="band-row" key={b.id}>
              <b>{b.label || classesLabel(db, b.classIds)}</b>
              <div className="chips">
                {b.parts.map((p, i) => {
                  const n = partSize(db, b, i) ?? 0;
                  const cap = p.roomId ? db.rooms[p.roomId]?.capacity : undefined;
                  return (
                    <button key={i} className={`chip ${cap && n > cap ? 'over' : ''}`} onClick={() => setRoster({ lesson: b, partIdx: i })}>
                      {db.subjects[p.subjectId]?.name ?? '?'} <b>{n}</b>
                      {cap ? `/${cap}` : ''}명
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {roster && <Roster lesson={roster.lesson} partIdx={roster.partIdx} onClose={() => setRoster(null)} />}
    </div>
  );
}
