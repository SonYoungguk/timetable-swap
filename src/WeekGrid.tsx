import type { EntityKind } from '../shared/model.ts';
import { addDays, occsOf, shortDate, toISO } from '../shared/week.ts';
import type { Occ, Week } from '../shared/week.ts';
import type { Db } from '../shared/types.ts';
import { classesLabel } from './ui.tsx';

export type ViewKind = EntityKind | 'student';
export interface CellHint {
  state: 'ok' | 'bad';
  title: string;
}

interface Item {
  occ: Occ;
  /** normal: 실제 수업, cancelled: 결강, away: 다른 시간·교사로 빠져나간 자리 */
  mode: 'normal' | 'cancelled' | 'away';
  note?: string;
}

/** 보는 사람에 맞춰 이 수업에서 보여 줄 강좌 번호들 */
function partsFor(pub: Db, o: Occ, kind: ViewKind, id: string, away: boolean): number[] {
  const parts = o.unit.lesson.parts;
  const all = parts.map((_, i) => i);
  if (kind === 'teacher') {
    const mine = all.filter((i) => (away ? parts[i].teacherId === id : o.teachers[i] === id));
    return mine.length ? mine : all;
  }
  if (kind === 'room') {
    const mine = all.filter((i) => parts[i].roomId === id);
    return mine.length ? mine : all;
  }
  if (kind === 'student' && parts.length > 1) {
    const pick = pub.students[id]?.choices[o.unit.lesson.id];
    return pick !== undefined && parts[pick] ? [pick] : all;
  }
  return all;
}

export function occCard(pub: Db, o: Occ, kind: ViewKind, id: string, away = false) {
  const l = o.unit.lesson;
  const idxs = partsFor(pub, o, kind, id, away);
  if (idxs.length > 1) return { title: l.label || '선택과목', lines: [kind === 'student' ? '수강 강좌 미정' : `${idxs.length}개 강좌`], color: '#eceff4' };
  const p = l.parts[idxs[0]];
  const subj = pub.subjects[p?.subjectId];
  const lines: string[] = [];
  if (kind === 'teacher' || kind === 'room') lines.push(classesLabel(pub, l.classIds));
  const teacher = o.teachers[idxs[0]];
  if (kind !== 'teacher' && teacher) lines.push(pub.teachers[teacher]?.name ?? '');
  if (kind !== 'room' && p?.roomId) lines.push(pub.rooms[p.roomId]?.name ?? '');
  return { title: subj?.short ?? '?', lines: lines.filter(Boolean), color: subj?.color ?? '#eceff4' };
}

export function WeekGrid(props: {
  pub: Db;
  week: Week;
  kind: ViewKind;
  id: string;
  selected?: string | null;
  hints?: Map<string, CellHint>;
  onPickOcc?: (o: Occ) => void;
  onPickCell?: (day: number, period: number) => void;
}) {
  const { pub, week, kind, id } = props;
  const s = week.settings;
  const maxP = Math.max(0, ...s.periodsPerDay);
  const today = toISO(new Date());
  const entKind: EntityKind = kind === 'student' ? 'class' : kind;
  const entId = kind === 'student' ? (pub.students[id]?.classId ?? '') : id;

  // 칸마다 무엇을 그릴지 모은다.
  const items = new Map<string, Item[]>();
  const push = (d: number, p: number, item: Item) => {
    const k = `${d}-${p}`;
    items.set(k, [...(items.get(k) ?? []), item]);
  };
  for (const o of occsOf(week, entKind, entId)) {
    if (o.cancelled) {
      push(o.origDay, o.origPeriod, { occ: o, mode: 'cancelled' });
      continue;
    }
    const here = entKind !== 'teacher' || o.teachers.includes(entId);
    if (here) push(o.day, o.period, { occ: o, mode: 'normal' });
    else {
      const i = o.unit.lesson.parts.findIndex((p) => p.teacherId === entId);
      push(o.day, o.period, { occ: o, mode: 'away', note: `대강: ${pub.teachers[o.teachers[i] ?? '']?.name ?? '?'}` });
    }
    if (o.moved && here) push(o.origDay, o.origPeriod, { occ: o, mode: 'away', note: `→ ${s.days[o.day]} ${o.period}교시` });
  }

  return (
    <div className="grid week" style={{ gridTemplateColumns: `36px repeat(${s.days.length}, minmax(0, 1fr))` }}>
      <div className="grid-head corner" />
      {s.days.map((d, i) => {
        const date = addDays(week.monday, i);
        return (
          <div className={`grid-head ${date === today ? 'today' : ''}`} key={d}>
            {d} <small>{shortDate(date)}</small>
          </div>
        );
      })}
      {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => (
        <div key={p} style={{ display: 'contents' }}>
          <div className={`grid-period ${p === s.lunchAfter ? 'lunch' : ''}`}>{p}</div>
          {s.days.map((_, d) => {
            const exists = p <= s.periodsPerDay[d];
            const list = items.get(`${d}-${p}`) ?? [];
            const hint = props.hints?.get(`${d}-${p}`);
            const real = list.filter((x) => x.mode === 'normal');
            const cls = ['cell', exists ? '' : 'none', p === s.lunchAfter ? 'lunch' : '', hint ? `hint-${hint.state}` : '', real.length > 1 ? 'clash' : ''].join(' ');
            return (
              <div
                key={d}
                className={cls}
                title={hint?.title}
                onClick={() => exists && !real.length && props.onPickCell?.(d, p)}
              >
                {list.map((it) => {
                  const o = it.occ;
                  const info = occCard(pub, o, kind, id, it.mode === 'away');
                  const badge = it.mode === 'cancelled' ? '결강' : it.mode === 'away' ? '' : o.moved ? '교체' : o.substituted ? '대강' : '';
                  return (
                    <div
                      key={o.key + it.mode}
                      className={`card ${it.mode} ${props.selected === o.key ? 'selected' : ''} ${badge ? 'changed' : ''} ${props.onPickOcc ? 'clickable' : ''}`}
                      style={{ background: info.color, ['--len' as string]: o.unit.len }}
                      onClick={(e) => {
                        if (!props.onPickOcc || it.mode === 'away') return;
                        e.stopPropagation();
                        props.onPickOcc(o);
                      }}
                    >
                      <div className="card-title">
                        {info.title}
                        {badge && <span className={`badge ${it.mode}`}>{badge}</span>}
                      </div>
                      {it.note ? <div className="card-line">{it.note}</div> : info.lines.map((l, i) => <div className="card-line" key={i}>{l}</div>)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function WeekNav(props: { monday: string; onChange: (monday: string) => void }) {
  const friday = addDays(props.monday, 4);
  return (
    <span className="picker weeknav">
      <button onClick={() => props.onChange(addDays(props.monday, -7))} aria-label="이전 주">
        ◀
      </button>
      <span className="week-label">
        {shortDate(props.monday)} ~ {shortDate(friday)}
      </span>
      <button onClick={() => props.onChange(addDays(props.monday, 7))} aria-label="다음 주">
        ▶
      </button>
    </span>
  );
}
