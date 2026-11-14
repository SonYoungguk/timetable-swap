import { useEffect, useState } from 'react';
import { lessonHours, sortedByName, sortedClasses } from '../../shared/model.ts';
import { getSettings } from '../../shared/types.ts';
import type { CollectionName, Collections, Op, Settings, Teacher } from '../../shared/types.ts';
import { clearAll, deleteTeacherOrRoom, importDb, lessonsUsing, loadDemo } from '../actions.ts';
import { newId, useStore } from '../store.ts';
import { Modal } from '../ui.tsx';

const PALETTE = ['#fde2e2', '#fdebd0', '#fff6bf', '#e2f5d3', '#d3f0ea', '#d6ebfb', '#e0e0fb', '#f1dcf7', '#fbdce9', '#e8e4d8'];

const put = <K extends CollectionName>(collection: K, doc: Collections[K]): Op => ({
  op: 'put',
  collection,
  doc: doc as unknown as { id: string } & Record<string, unknown>,
});

/** 입력을 마쳤을 때(포커스 이동·Enter)만 저장하는 입력 칸 */
export function TextCell(props: { value: string; onCommit: (v: string) => void; type?: string; width?: number; min?: number; max?: number }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  return (
    <input
      type={props.type ?? 'text'}
      value={v}
      min={props.min}
      max={props.max}
      style={{ width: props.width }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== props.value && props.onCommit(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function BulkAdd(props: { label: string; hint: string; onAdd: (rows: string[][]) => void }) {
  const [text, setText] = useState('');
  const rows = text
    .split('\n')
    .map((l) => l.split(/\t|,/).map((x) => x.trim()))
    .filter((r) => r[0]);
  return (
    <div className="bulk">
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={props.hint} rows={3} />
      <button
        className="primary"
        disabled={!rows.length}
        onClick={() => {
          props.onAdd(rows);
          setText('');
        }}
      >
        {props.label} {rows.length > 0 && `(${rows.length})`}
      </button>
    </div>
  );
}

function UnavailableEditor(props: { teacher: Teacher; onClose: () => void }) {
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const s = getSettings(db);
  const teacher = db.teachers[props.teacher.id] ?? props.teacher;
  const set = new Set(teacher.unavailable);
  const toggle = (keys: string[]) => {
    const allOn = keys.every((k) => set.has(k));
    keys.forEach((k) => (allOn ? set.delete(k) : set.add(k)));
    mutate([put('teachers', { ...teacher, unavailable: [...set] })]);
  };
  const maxP = Math.max(...s.periodsPerDay);
  return (
    <Modal title={`${teacher.name} — 수업 불가 시간`} onClose={props.onClose}>
      <p className="muted">수업을 넣으면 안 되는 칸을 눌러 표시하세요. 요일 이름을 누르면 하루 전체가 바뀝니다.</p>
      <table className="mini">
        <thead>
          <tr>
            <th />
            {s.days.map((d, di) => (
              <th key={d}>
                <button onClick={() => toggle(Array.from({ length: s.periodsPerDay[di] }, (_, i) => `${di}-${i + 1}`))}>{d}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => (
            <tr key={p}>
              <th>{p}</th>
              {s.days.map((_, di) =>
                p <= s.periodsPerDay[di] ? (
                  <td key={di} className={set.has(`${di}-${p}`) ? 'off' : ''} onClick={() => toggle([`${di}-${p}`])}>
                    {set.has(`${di}-${p}`) ? '불가' : ''}
                  </td>
                ) : (
                  <td key={di} className="none" />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button className="primary" onClick={props.onClose}>
          완료
        </button>
      </div>
    </Modal>
  );
}

function SettingsTab() {
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const s = getSettings(db);
  const save = (patch: Partial<Settings>) => mutate([put('settings', { ...s, ...patch })]);
  const num = (v: string, lo: number, hi: number, fallback: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  const counts = `교사 ${Object.keys(db.teachers).length} · 과목 ${Object.keys(db.subjects).length} · 학급 ${Object.keys(db.classes).length} · 수업 ${Object.keys(db.lessons).length}`;
  return (
    <div className="form narrow">
      <label>
        학교 이름
        <TextCell value={s.schoolName} onCommit={(v) => save({ schoolName: v })} />
      </label>
      <div>
        <div className="label">요일별 교시 수</div>
        <div className="row">
          {s.days.map((d, i) => (
            <label key={d} className="inline">
              {d}
              <TextCell
                type="number"
                min={0}
                max={12}
                width={56}
                value={String(s.periodsPerDay[i])}
                onCommit={(v) => save({ periodsPerDay: s.periodsPerDay.map((x, j) => (j === i ? num(v, 0, 12, x) : x)) })}
              />
            </label>
          ))}
        </div>
      </div>
      <label>
        점심시간은 몇 교시 뒤인가요?
        <TextCell type="number" min={1} max={12} width={70} value={String(s.lunchAfter)} onCommit={(v) => save({ lunchAfter: num(v, 1, 12, s.lunchAfter) })} />
        <small>연강이 점심시간에 걸치지 않게 하고, 연속 수업 계산을 여기서 끊습니다.</small>
      </label>
      <label>
        교사 하루 최대 수업 (권장)
        <TextCell type="number" min={1} max={12} width={70} value={String(s.maxTeacherPerDay)} onCommit={(v) => save({ maxTeacherPerDay: num(v, 1, 12, s.maxTeacherPerDay) })} />
      </label>
      <label>
        교사 최대 연속 수업 (권장)
        <TextCell
          type="number"
          min={1}
          max={12}
          width={70}
          value={String(s.maxTeacherConsecutive)}
          onCommit={(v) => save({ maxTeacherConsecutive: num(v, 1, 12, s.maxTeacherConsecutive) })}
        />
      </label>
      <hr />
      <div className="label">자료 전체</div>
      <p className="muted">현재: {counts}</p>
      <div className="row">
        <button
          onClick={() => {
            if (confirm('지금 있는 자료를 모두 지우고 예시 학교(3개 학년 × 6학급)를 불러올까요?')) loadDemo();
          }}
        >
          예시 학교 불러오기
        </button>
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(db)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `시간표-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          파일로 내보내기
        </button>
        <label className="file-button">
          파일에서 가져오기
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const data = JSON.parse(await file.text());
                if (!data || typeof data !== 'object' || !data.lessons) throw new Error();
                if (confirm('지금 있는 자료를 모두 지우고 이 파일의 자료로 바꿀까요?')) importDb(data);
              } catch {
                alert('시간표 자료 파일이 아닙니다.');
              }
            }}
          />
        </label>
        <button
          className="danger"
          onClick={() => {
            if (confirm('교사·과목·학급·수업·시간표를 모두 지울까요?')) clearAll();
          }}
        >
          전체 지우기
        </button>
      </div>
    </div>
  );
}

function TeachersTab() {
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const hours = new Map<string, number>();
  for (const l of Object.values(db.lessons))
    for (const t of new Set(l.parts.map((p) => p.teacherId))) if (t) hours.set(t, (hours.get(t) ?? 0) + lessonHours(l));
  return (
    <>
      <BulkAdd
        label="교사 추가"
        hint="교사 이름을 한 줄에 한 명씩 입력하세요. 엑셀에서 이름 열을 복사해 붙여넣어도 됩니다."
        onAdd={(rows) => mutate(rows.map((r) => put('teachers', { id: newId(), name: r[0], unavailable: [] })))}
      />
      <table className="data">
        <thead>
          <tr>
            <th>이름</th>
            <th>주당 수업</th>
            <th>수업 불가 시간</th>
            <th>전용 교실 (교과교실제)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sortedByName(db.teachers).map((t) => (
            <tr key={t.id}>
              <td>
                <TextCell value={t.name} onCommit={(v) => v.trim() && mutate([put('teachers', { ...t, name: v.trim() })])} />
              </td>
              <td>{hours.get(t.id) ?? 0}시간</td>
              <td>
                <button onClick={() => setEditing(t)}>{t.unavailable.length ? `${t.unavailable.length}칸 불가` : '설정'}</button>
              </td>
              <td>
                <select value={t.roomId ?? ''} onChange={(e) => mutate([put('teachers', { ...t, roomId: e.target.value || null })])}>
                  <option value="">없음</option>
                  {sortedByName(db.rooms).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  className="ghost danger"
                  onClick={() => {
                    const n = hours.get(t.id) ?? 0;
                    if (!n || confirm(`${t.name} 교사를 지울까요? 맡고 있던 수업 ${n}시간은 '교사 미정'이 됩니다.`)) deleteTeacherOrRoom('teachers', t.id);
                  }}
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <UnavailableEditor teacher={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SubjectsTab() {
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const list = sortedByName(db.subjects);
  return (
    <>
      <BulkAdd
        label="과목 추가"
        hint={'과목 이름을 한 줄에 하나씩. 약칭을 같이 넣으려면 탭이나 쉼표로 구분하세요.\n예) 통합사회, 통사'}
        onAdd={(rows) =>
          mutate(
            rows.map((r, i) =>
              put('subjects', { id: newId(), name: r[0], short: r[1] || r[0].slice(0, 2), color: PALETTE[(list.length + i) % PALETTE.length] }),
            ),
          )
        }
      />
      <table className="data">
        <thead>
          <tr>
            <th>과목</th>
            <th>약칭 (시간표 표시)</th>
            <th>색</th>
            <th>필요한 교실 종류</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td>
                <TextCell value={s.name} onCommit={(v) => v.trim() && mutate([put('subjects', { ...s, name: v.trim() })])} />
              </td>
              <td>
                <TextCell value={s.short} width={90} onCommit={(v) => mutate([put('subjects', { ...s, short: v.trim() || s.name.slice(0, 2) })])} />
              </td>
              <td>
                <input type="color" value={s.color} onChange={(e) => mutate([put('subjects', { ...s, color: e.target.value })])} />
              </td>
              <td>
                <select value={s.roomKind ?? ''} onChange={(e) => mutate([put('subjects', { ...s, roomKind: e.target.value || undefined })])}>
                  <option value="">상관없음</option>
                  {[...new Set(Object.values(db.rooms).map((r) => r.kind).filter(Boolean))].sort().map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  className="ghost danger"
                  onClick={() => {
                    const n = lessonsUsing(db, 'subjects', s.id);
                    if (n) alert(`이 과목을 쓰는 수업이 ${n}개 있습니다. 수업 배정에서 먼저 지우거나 과목을 바꿔 주세요.`);
                    else mutate([{ op: 'del', collection: 'subjects', id: s.id }]);
                  }}
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function RoomsTab() {
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  return (
    <>
      <p className="muted">
        여러 반이 번갈아 쓰는 교실(과학실·음악실·선택교실 등)만 등록하면 됩니다. 수업에 교실을 지정하면 같은 시간에 겹치지 않게 관리합니다.
      </p>
      <BulkAdd
        label="교실 추가"
        hint={'교실 이름을 한 줄에 하나씩. 종류를 같이 넣으려면 탭이나 쉼표로 구분하세요.\n예) 과학실1, 과학실, 30   (이름, 종류, 수용 인원)'}
        onAdd={(rows) => mutate(rows.map((r) => put('rooms', { id: newId(), name: r[0], kind: r[1] || '', capacity: Math.max(0, Math.round(Number(r[2]) || 0)) })))}
      />
      <table className="data">
        <thead>
          <tr>
            <th>교실</th>
            <th>종류</th>
            <th>수용 인원</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sortedByName(db.rooms).map((r) => (
            <tr key={r.id}>
              <td>
                <TextCell value={r.name} onCommit={(v) => v.trim() && mutate([put('rooms', { ...r, name: v.trim() })])} />
              </td>
              <td>
                <TextCell value={r.kind} onCommit={(v) => mutate([put('rooms', { ...r, kind: v.trim() })])} />
              </td>
              <td>
                <TextCell type="number" min={0} width={70} value={r.capacity ? String(r.capacity) : ''} onCommit={(v) => mutate([put('rooms', { ...r, capacity: Math.max(0, Math.round(Number(v) || 0)) })])} />
              </td>
              <td>
                <button className="ghost danger" onClick={() => confirm(`${r.name}을(를) 지울까요?`) && deleteTeacherOrRoom('rooms', r.id)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ClassesTab() {
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const [grade, setGrade] = useState(1);
  const [count, setCount] = useState(6);
  const list = sortedClasses(db);
  return (
    <>
      <div className="row bulk">
        <label className="inline">
          <input type="number" min={1} max={6} value={grade} onChange={(e) => setGrade(Number(e.target.value))} style={{ width: 56 }} />
          학년에
        </label>
        <label className="inline">
          <input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 56 }} />
          반까지
        </label>
        <button
          className="primary"
          onClick={() => {
            const ops: Op[] = [];
            for (let n = 1; n <= count; n++)
              if (!list.some((c) => c.grade === grade && c.num === n)) ops.push(put('classes', { id: newId(), grade, num: n, name: `${grade}-${n}` }));
            mutate(ops);
          }}
        >
          학급 만들기
        </button>
      </div>
      <table className="data">
        <thead>
          <tr>
            <th>학년</th>
            <th>반</th>
            <th>표시 이름</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id}>
              <td>{c.grade}</td>
              <td>{c.num}</td>
              <td>
                <TextCell value={c.name} width={120} onCommit={(v) => v.trim() && mutate([put('classes', { ...c, name: v.trim() })])} />
              </td>
              <td>
                <button
                  className="ghost danger"
                  onClick={() => {
                    const n = lessonsUsing(db, 'classes', c.id);
                    if (n) alert(`이 학급의 수업이 ${n}개 있습니다. 수업 배정에서 먼저 지워 주세요.`);
                    else {
                      const inClass = Object.values(db.students).filter((s) => s.classId === c.id);
                      if (inClass.length && !confirm(`${c.name} 학급과 학생 ${inClass.length}명을 함께 지울까요?`)) return;
                      mutate([...inClass.map((s): Op => ({ op: 'del', collection: 'students', id: s.id })), { op: 'del', collection: 'classes', id: c.id }]);
                    }
                  }}
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const TABS = [
  ['settings', '학교 설정', SettingsTab],
  ['teachers', '교사', TeachersTab],
  ['subjects', '과목', SubjectsTab],
  ['rooms', '교실', RoomsTab],
  ['classes', '학급', ClassesTab],
] as const;

export function SetupPage() {
  const [tab, setTab] = useState<string>('settings');
  const Tab = TABS.find((t) => t[0] === tab)![2];
  return (
    <div className="page">
      <div className="toolbar">
        <div className="seg">
          {TABS.map(([key, label]) => (
            <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="panel">
        <Tab />
      </div>
    </div>
  );
}
