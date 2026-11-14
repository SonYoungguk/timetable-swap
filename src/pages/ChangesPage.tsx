import { useMemo, useState } from 'react';
import type { EntityKind } from '../../shared/model.ts';
import type { Change, Op } from '../../shared/types.ts';
import {
  buildWeek,
  cancelChange,
  describeChange,
  freeTeachers,
  mondayOf,
  moveChange,
  substituteChange,
  swapCandidates,
  swapChanges,
  toISO,
  tryChanges,
} from '../../shared/week.ts';
import type { Occ } from '../../shared/week.ts';
import { newId, usePub, useStore } from '../store.ts';
import { KIND_LABEL, classesLabel, entitiesOf } from '../ui.tsx';
import { WeekGrid, WeekNav, occCard } from '../WeekGrid.tsx';
import type { CellHint } from '../WeekGrid.tsx';
import { EntityPicker } from './SchedulePage.tsx';

const putChange = (c: Change): Op => ({ op: 'put', collection: 'changes', doc: c as unknown as { id: string } & Record<string, unknown> });

/** 이번 주 변경 내역 (조회 화면과 함께 쓴다) */
export function ChangeList(props: { monday: string; onUndo?: (groupId: string) => void }) {
  const pub = usePub();
  const week = useMemo(() => (pub ? buildWeek(pub, props.monday) : null), [pub, props.monday]);
  if (!pub || !week) return null;
  const inWeek = week.occs.filter((o) => o.change).map((o) => o.change!);
  const groups = new Map<string, Change[]>();
  for (const c of inWeek.sort((a, b) => b.createdAt - a.createdAt)) groups.set(c.groupId, [...(groups.get(c.groupId) ?? []), c]);
  if (!groups.size) return <p className="muted">이번 주에는 변경된 수업이 없습니다.</p>;
  return (
    <ul className="change-list">
      {[...groups].map(([gid, list]) => (
        <li key={gid}>
          <div>
            {list.map((c) => (
              <div key={c.id}>{describeChange(pub, week.index, c)}</div>
            ))}
            {list[0].note && <small>사유: {list[0].note}</small>}
          </div>
          {props.onUndo && (
            <button className="ghost danger" onClick={() => props.onUndo!(gid)}>
              되돌리기
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ChangesPage() {
  const pub = usePub();
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const [monday, setMonday] = useState(() => mondayOf(toISO(new Date())));
  const [kind, setKind] = useState<EntityKind>('teacher');
  const [ids, setIds] = useState<Record<EntityKind, string>>({ class: '', teacher: '', room: '' });
  const [selKey, setSelKey] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const week = useMemo(() => (pub ? buildWeek(pub, monday) : null), [pub, monday]);
  const list = pub ? entitiesOf(pub, kind) : [];
  const id = list.some((e) => e.id === ids[kind]) ? ids[kind] : (list[0]?.id ?? '');
  const sel: Occ | null = (selKey && week?.occs.find((o) => o.key === selKey)) || null;

  const candidates = useMemo(() => (pub && week && sel && !sel.cancelled ? swapCandidates(pub, week, sel, 0) : []), [pub, week, sel]);

  // 선택한 수업을 각 칸으로 옮기거나 그 칸의 수업과 바꾸면 어떻게 되는지
  const hints = useMemo(() => {
    const map = new Map<string, CellHint>();
    if (!pub || !week || !sel || sel.cancelled) return map;
    const s = week.settings;
    const viewHas = (o: Occ) => (kind === 'class' ? o.unit.lesson.classIds.includes(id) : kind === 'teacher' ? o.teachers.includes(id) : o.unit.lesson.parts.some((p) => p.roomId === id));
    for (let d = 0; d < s.days.length; d++)
      for (let p = 1; p <= s.periodsPerDay[d]; p++) {
        if (d === sel.day && p === sel.period) continue;
        const here = week.occs.filter((o) => !o.cancelled && o.day === d && o.period === p && viewHas(o));
        if (here.length === 0) {
          const problems = tryChanges(pub, monday, [moveChange(week, sel, d, p, 'x', 0)]);
          map.set(`${d}-${p}`, { state: problems.length ? 'bad' : 'ok', title: problems.join('\n') || '이 시간으로 옮기기' });
        } else if (here.length === 1 && here[0].unit.len === sel.unit.len && here[0].key !== sel.key) {
          const problems = tryChanges(pub, monday, swapChanges(week, sel, here[0], 'x', 0));
          map.set(`${d}-${p}`, { state: problems.length ? 'bad' : 'ok', title: problems.join('\n') || '이 수업과 맞바꾸기' });
        }
      }
    return map;
  }, [pub, week, sel, kind, id, monday]);

  if (!pub || !week)
    return (
      <div className="page">
        <div className="empty">
          아직 게시된 시간표가 없습니다. <b>③ 시간표 편성</b>을 마친 뒤 위쪽 <b>게시</b> 버튼을 누르면, 그 시간표를 기준으로 날짜별 수업 교체를 할 수
          있습니다.
        </div>
      </div>
    );

  const apply = (changes: Change[]) => {
    const problems = tryChanges(pub, monday, changes);
    if (problems.length && !confirm(`이렇게 바꾸면 겹치는 곳이 있습니다.\n\n${problems.join('\n')}\n\n그래도 적용할까요?`)) return;
    const gid = newId();
    const now = Date.now();
    mutate(changes.map((c) => putChange({ ...c, groupId: gid, createdAt: now, note: note.trim() })));
    setSelKey(null);
    setNote('');
  };
  const undoGroup = (gid: string) =>
    mutate(
      Object.values(db.changes)
        .filter((c) => c.groupId === gid)
        .map((c): Op => ({ op: 'del', collection: 'changes', id: c.id })),
    );

  const pickOcc = (o: Occ) => {
    if (!sel || sel.cancelled) return setSelKey(o.key);
    if (o.key === sel.key) return setSelKey(null);
    if (o.cancelled || o.unit.len !== sel.unit.len) return setSelKey(o.key);
    apply(swapChanges(week, sel, o, '', 0));
  };

  const selInfo = sel ? occCard(pub, sel, 'class', sel.unit.lesson.classIds[0]) : null;

  return (
    <div className="page schedule">
      <div className="toolbar">
        <WeekNav monday={monday} onChange={(m) => (setMonday(m), setSelKey(null))} />
        <button onClick={() => (setMonday(mondayOf(toISO(new Date()))), setSelKey(null))}>이번 주</button>
        <div className="seg">
          {(['teacher', 'class', 'room'] as EntityKind[]).map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}별
            </button>
          ))}
        </div>
        <EntityPicker kind={kind} id={id} onChange={(v) => setIds((x) => ({ ...x, [kind]: v }))} db={pub} />
      </div>
      <div className="schedule-body">
        <div className="schedule-main">
          <WeekGrid pub={pub} week={week} kind={kind} id={id} selected={selKey} hints={hints} onPickOcc={pickOcc} onPickCell={(d, p) => sel && !sel.cancelled && apply([moveChange(week, sel, d, p, '', 0)])} />
          <p className="muted legend">
            바꿀 수업을 누른 뒤 → 맞바꿀 수업이나 빈 칸을 누르세요. <span className="sw ok" /> 겹치지 않음 <span className="sw bad" /> 겹침
          </p>
          <div className="panel" style={{ marginTop: 12 }}>
            <div className="label">이번 주 변경 내역</div>
            <ChangeList monday={monday} onUndo={undoGroup} />
          </div>
        </div>
        <aside className="issues">
          {!sel && <p className="muted">시간표에서 수업을 누르면 교체 가능한 수업, 대강 가능한 교사가 여기에 나옵니다.</p>}
          {sel && selInfo && (
            <>
              <h4 style={{ marginTop: 0 }}>
                {sel.unit.lesson.label || pub.subjects[sel.unit.lesson.parts[0].subjectId]?.name} · {classesLabel(pub, sel.unit.lesson.classIds)}
              </h4>
              <p className="muted">
                {week.settings.days[sel.day]} {sel.period}교시
                {sel.cancelled ? ' · 결강 처리됨' : sel.moved ? ` · 원래 ${week.settings.days[sel.origDay]} ${sel.origPeriod}교시` : ''}
              </p>
              <label className="note">
                사유 (선택)
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예) 출장, 연수" />
              </label>
              {sel.change && (
                <button onClick={() => (undoGroup(sel.change!.groupId), setSelKey(null))}>이 변경 되돌리기</button>
              )}
              {!sel.cancelled && (
                <>
                  <h4>맞바꿀 수 있는 수업 {candidates.length}개</h4>
                  <ul>
                    {candidates.slice(0, 40).map((c) => {
                      const o = c.other;
                      const info = occCard(pub, o, 'class', o.unit.lesson.classIds[0]);
                      return (
                        <li key={o.key} onClick={() => apply(c.changes)}>
                          <b>
                            {week.settings.days[o.day]} {o.period}교시
                          </b>{' '}
                          {info.title} {info.lines[0] ?? ''} <small>{classesLabel(pub, o.unit.lesson.classIds)}</small>
                        </li>
                      );
                    })}
                  </ul>
                  {!candidates.length && <p className="muted">겹치지 않고 바꿀 수 있는 수업이 없습니다.</p>}
                  {sel.unit.lesson.parts.map((p, i) => {
                    const free = freeTeachers(pub, week, sel, i);
                    return (
                      <div key={i}>
                        <h4>
                          대강{sel.unit.lesson.parts.length > 1 ? ` — ${pub.subjects[p.subjectId]?.name}` : ''} (현재 {pub.teachers[sel.teachers[i] ?? '']?.name ?? '미정'})
                        </h4>
                        <select value="" onChange={(e) => e.target.value && apply([substituteChange(sel, i, e.target.value, '', 0)])}>
                          <option value="">이 시간에 비는 교사 {free.length}명…</option>
                          {free.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.same ? '★ ' : ''}
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                  <p className="muted" style={{ fontSize: 12 }}>★ 같은 과목을 가르치는 교사</p>
                  <button className="danger" onClick={() => apply([cancelChange(sel, '', 0)])}>
                    결강 처리
                  </button>
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
