import { useEffect, useMemo, useRef, useState } from 'react';
import { sortedClasses } from '../../shared/model.ts';
import type { EntityKind } from '../../shared/model.ts';
import { getSettings } from '../../shared/types.ts';
import type { Db } from '../../shared/types.ts';
import { buildWeek, describeChange, mondayOf, occsAt, toISO } from '../../shared/week.ts';
import type { Week } from '../../shared/week.ts';
import { usePub, useStore } from '../store.ts';
import { KIND_LABEL, entitiesOf } from '../ui.tsx';
import { WeekGrid, WeekNav, occCard } from '../WeekGrid.tsx';
import type { ViewKind } from '../WeekGrid.tsx';
import { ChangeList } from './ChangesPage.tsx';
import { EntityPicker } from './SchedulePage.tsx';

type View = ViewKind | 'all-class' | 'all-teacher' | 'all-room';
const VIEWS: [View, string][] = [
  ['class', '학급'],
  ['teacher', '교사'],
  ['room', '교실'],
  ['student', '학생'],
  ['all-class', '전체(학급)'],
  ['all-teacher', '전체(교사)'],
  ['all-room', '전체(교실)'],
];

const remember = {
  get(): { view?: View; ids?: Record<string, string> } {
    try {
      return JSON.parse(localStorage.getItem('tt-view') ?? '{}');
    } catch {
      return {};
    }
  },
  set(v: unknown) {
    try {
      localStorage.setItem('tt-view', JSON.stringify(v));
    } catch {
      /* 저장소를 못 쓰는 환경에서는 기억하지 않는다 */
    }
  },
};

function WeekOverview(props: { pub: Db; week: Week; kind: EntityKind; onPick: (id: string) => void }) {
  const { pub, week, kind } = props;
  const s = week.settings;
  return (
    <div className="overview-wrap">
      <table className="overview">
        <thead>
          <tr>
            <th rowSpan={2}>{KIND_LABEL[kind]}</th>
            {s.days.map((d, di) => (
              <th key={d} colSpan={s.periodsPerDay[di]} className="day-start">
                {d}
              </th>
            ))}
          </tr>
          <tr>
            {s.days.flatMap((_, di) =>
              Array.from({ length: s.periodsPerDay[di] }, (_, i) => (
                <th key={`${di}-${i}`} className={i === 0 ? 'day-start' : ''}>
                  {i + 1}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {entitiesOf(pub, kind).map((r) => (
            <tr key={r.id}>
              <th className="row-head" onClick={() => props.onPick(r.id)}>
                {r.name}
              </th>
              {s.days.flatMap((_, di) =>
                Array.from({ length: s.periodsPerDay[di] }, (_, i) => {
                  const o = occsAt(week, kind, r.id, di, i + 1)[0];
                  const info = o ? occCard(pub, o, kind, r.id) : null;
                  const text = info ? (kind === 'class' ? info.title.replace(/^\d+학년\s*/, '') : (info.lines[0] ?? info.title)) : '';
                  return (
                    <td
                      key={`${di}-${i}`}
                      className={`${i === 0 ? 'day-start' : ''} ${o?.change ? 'changed' : ''}`}
                      style={{ background: info?.color }}
                      title={info ? [info.title, ...info.lines].join(' · ') : undefined}
                    >
                      {text}
                    </td>
                  );
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StudentPicker(props: { pub: Db; id: string; onChange: (id: string) => void }) {
  const { pub } = props;
  const classes = sortedClasses(pub);
  const current = pub.students[props.id];
  const [classId, setClassId] = useState(current?.classId ?? classes[0]?.id ?? '');
  const inClass = Object.values(pub.students)
    .filter((s) => s.classId === classId)
    .sort((a, b) => a.num - b.num);
  useEffect(() => {
    if (inClass.length && !inClass.some((s) => s.id === props.id)) props.onChange(inClass[0].id);
  });
  return (
    <span className="picker">
      <select value={classId} onChange={(e) => setClassId(e.target.value)}>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select value={props.id} onChange={(e) => props.onChange(e.target.value)}>
        {inClass.map((s) => (
          <option key={s.id} value={s.id}>
            {s.num}번 {s.name}
          </option>
        ))}
      </select>
    </span>
  );
}

/** 새로 들어온 변경을 잠깐 알려 준다. */
function useChangeToast(pub: Db | null, week: Week | null) {
  const [toast, setToast] = useState<string | null>(null);
  const seen = useRef<Db['changes'] | null>(null);
  useEffect(() => {
    if (!pub || !week) return;
    const prev = seen.current;
    seen.current = pub.changes;
    if (!prev || prev === pub.changes) return;
    const fresh = Object.values(pub.changes).filter((c) => prev[c.id]?.createdAt !== c.createdAt);
    const removed = Object.keys(prev).filter((id) => !pub.changes[id]).length;
    if (!fresh.length && !removed) return;
    setToast(fresh.length ? `시간표 변경: ${describeChange(pub, week.index, fresh[0])}${fresh.length > 1 ? ` 외 ${fresh.length - 1}건` : ''}` : '수업 변경이 취소되었습니다.');
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [pub, week]);
  return toast;
}

/** 읽기 전용 조회 화면. 로그인하지 않은 사람에게는 이 화면만 보인다. */
export function ViewPage() {
  const pub = usePub();
  const admin = useStore((s) => s.admin);
  const own = useStore((s) => s.db);
  const saved = useMemo(() => remember.get(), []);
  const [view, setView] = useState<View>(saved.view ?? 'class');
  const [ids, setIds] = useState<Record<string, string>>(saved.ids ?? {});
  const [monday, setMonday] = useState(() => mondayOf(toISO(new Date())));
  const week = useMemo(() => (pub ? buildWeek(pub, monday) : null), [pub, monday]);
  const toast = useChangeToast(pub, week);
  useEffect(() => remember.set({ view, ids }), [view, ids]);

  if (!pub || !week)
    return (
      <div className="page">
        <div className="empty">
          아직 게시된 시간표가 없습니다.
          {admin && ' 시간표 편성을 마친 뒤 위쪽의 게시 버튼을 누르면 여기에 공개됩니다.'}
        </div>
      </div>
    );

  const hasStudents = Object.keys(pub.students).length > 0;
  const single: ViewKind | null = view === 'class' || view === 'teacher' || view === 'room' || view === 'student' ? view : null;
  const list = single && single !== 'student' ? entitiesOf(pub, single) : [];
  const currentId = !single ? '' : single === 'student' ? (pub.students[ids.student] ? ids.student : '') : list.some((e) => e.id === ids[single]) ? ids[single] : (list[0]?.id ?? '');
  const go = (kind: string, id: string) => {
    setIds((x) => ({ ...x, [kind]: id }));
    setView(kind as View);
  };
  const st = pub.students[currentId];
  const name = single === 'student' ? (st ? `${pub.classes[st.classId]?.name ?? ''} ${st.num}번 ${st.name}` : '') : (list.find((e) => e.id === currentId)?.name ?? '');
  const pubAt = own.published.main?.publishedAt;

  return (
    <div className="page view">
      {toast && <div className="toast no-print">{toast}</div>}
      <div className="toolbar no-print">
        <div className="seg">
          {VIEWS.filter(([v]) => v !== 'student' || hasStudents).map(([v, label]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {label}
            </button>
          ))}
        </div>
        {single && single !== 'student' && <EntityPicker kind={single} id={currentId} onChange={(id) => go(single, id)} db={pub} />}
        {single === 'student' && <StudentPicker pub={pub} id={currentId} onChange={(id) => go('student', id)} />}
        <span className="spacer" />
        <WeekNav monday={monday} onChange={setMonday} />
        <button onClick={() => setMonday(mondayOf(toISO(new Date())))}>이번 주</button>
        <button onClick={() => window.print()}>인쇄</button>
      </div>
      <div className="panel">
        <h2 className="view-title">
          {getSettings(pub).schoolName} {single ? `${name} 시간표` : `${VIEWS.find(([v]) => v === view)![1]} 시간표`}
          {admin && pubAt && <small> · {new Date(pubAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })} 게시본</small>}
        </h2>
        {single && currentId && <WeekGrid pub={pub} week={week} kind={single} id={currentId} />}
        {single && !currentId && <div className="empty">표시할 대상이 없습니다.</div>}
        {view === 'all-class' && <WeekOverview pub={pub} week={week} kind="class" onPick={(id) => go('class', id)} />}
        {view === 'all-teacher' && <WeekOverview pub={pub} week={week} kind="teacher" onPick={(id) => go('teacher', id)} />}
        {view === 'all-room' && <WeekOverview pub={pub} week={week} kind="room" onPick={(id) => go('room', id)} />}
        <div className="no-print">
          <div className="label" style={{ marginTop: 16 }}>
            이번 주 변경 사항
          </div>
          <ChangeList monday={monday} />
        </div>
      </div>
    </div>
  );
}
