import { useMemo } from 'react';
import { checkPlacement, startError, unitsAt } from '../shared/model.ts';
import type { EntityKind, Unit } from '../shared/model.ts';
import type { Op } from '../shared/types.ts';
import { setPlacement } from './actions.ts';
import { useAnalysis, useIndex, useStore } from './store.ts';
import { cardInfo, lessonTooltip } from './ui.tsx';

interface Props {
  kind: EntityKind;
  id: string;
  editable: boolean;
  dragId?: string | null;
  setDragId?: (id: string | null) => void;
}

type Hint = { state: 'ok' | 'swap' | 'bad'; reasons: string[]; swapWith?: Unit };

export function UnitCard(props: {
  unit: Unit;
  kind: EntityKind;
  id: string;
  editable: boolean;
  conflict?: boolean;
  setDragId?: (id: string | null) => void;
}) {
  const { unit, kind, id, editable } = props;
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const info = cardInfo(db, unit.lesson, kind, id);
  const pl = unit.placement;
  return (
    <div
      className={`card ${props.conflict ? 'conflict' : ''} ${pl?.pinned ? 'pinned' : ''} ${unit.len > 1 ? 'double' : ''}`}
      style={{ background: info.color, ['--len' as string]: unit.len }}
      title={lessonTooltip(db, unit.lesson)}
      draggable={editable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', unit.id);
        e.dataTransfer.effectAllowed = 'move';
        // 끌기 시작 직후에 화면이 바뀌면 브라우저가 끌기를 취소하므로 한 박자 늦춘다.
        setTimeout(() => props.setDragId?.(unit.id), 0);
      }}
      onDragEnd={() => props.setDragId?.(null)}
    >
      <div className="card-title">
        {info.title}
        {unit.len > 1 && <span className="len">{unit.len}연강</span>}
      </div>
      {info.lines.map((l, i) => (
        <div className="card-line" key={i}>
          {l}
        </div>
      ))}
      {pl?.pinned && <span className="pin-mark" title="고정됨">📌</span>}
      {editable && pl && (
        <div className="card-tools">
          <button
            title={pl.pinned ? '고정 해제' : '이 자리에 고정 (자동 편성이 옮기지 않음)'}
            onClick={() => mutate([setPlacement(unit, pl.day, pl.period, !pl.pinned)])}
          >
            {pl.pinned ? '해제' : '고정'}
          </button>
          <button title="시간표에서 빼기" onClick={() => mutate([{ op: 'del', collection: 'placements', id: unit.id }])}>
            빼기
          </button>
        </div>
      )}
    </div>
  );
}

export function TimetableGrid({ kind, id, editable, dragId, setDragId }: Props) {
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const index = useIndex();
  const analysis = useAnalysis();
  const s = index.settings;
  const maxP = Math.max(0, ...s.periodsPerDay);
  const dragUnit = dragId ? (index.units.get(dragId) ?? null) : null;
  const unavailable = kind === 'teacher' ? new Set(db.teachers[id]?.unavailable ?? []) : new Set<string>();

  // 끌고 있는 수업을 각 칸에 놓으면 어떻게 되는지 미리 계산한다.
  const hints = useMemo(() => {
    const map = new Map<string, Hint>();
    if (!dragUnit) return map;
    for (let d = 0; d < s.days.length; d++) {
      for (let p = 1; p <= s.periodsPerDay[d]; p++) {
        const err = startError(s, d, p, dragUnit.len);
        if (err) {
          map.set(`${d}-${p}`, { state: 'bad', reasons: [err] });
          continue;
        }
        const here = unitsAt(index, kind, id, d, p).filter((u) => u.id !== dragUnit.id);
        const other = here.length === 1 && here[0].len === dragUnit.len ? here[0] : null;
        if (other?.placement) {
          const reasons = checkPlacement(db, index, dragUnit, other.placement.day, other.placement.period, new Set([other.id]));
          const from = dragUnit.placement;
          if (from) reasons.push(...checkPlacement(db, index, other, from.day, from.period, new Set([dragUnit.id])));
          map.set(`${d}-${p}`, { state: reasons.length ? 'bad' : 'swap', reasons, swapWith: other });
        } else {
          const reasons = checkPlacement(db, index, dragUnit, d, p, new Set());
          map.set(`${d}-${p}`, { state: reasons.length ? 'bad' : 'ok', reasons });
        }
      }
    }
    return map;
  }, [dragUnit, index, db, kind, id, s]);

  const drop = (d: number, p: number) => {
    const u = dragUnit;
    setDragId?.(null);
    if (!u || startError(s, d, p, u.len)) return;
    const hint = hints.get(`${d}-${p}`);
    const other = hint?.swapWith;
    const ops: Op[] = [];
    if (other?.placement) {
      // 같은 길이 수업이 있으면 서로 자리를 바꾼다. 미배치에서 끌어온 경우 원래 수업은 미배치로 간다.
      ops.push(setPlacement(u, other.placement.day, other.placement.period, false));
      if (u.placement) ops.push(setPlacement(other, u.placement.day, u.placement.period, other.placement.pinned));
      else ops.push({ op: 'del', collection: 'placements', id: other.id });
    } else {
      if (u.placement?.day === d && u.placement.period === p) return;
      ops.push(setPlacement(u, d, p, u.placement?.pinned ?? false));
    }
    mutate(ops);
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: `44px repeat(${s.days.length}, minmax(96px, 1fr))` }}>
      <div className="grid-head corner" />
      {s.days.map((d) => (
        <div className="grid-head" key={d}>
          {d}
        </div>
      ))}
      {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => (
        <div className="grid-row" key={p} style={{ display: 'contents' }}>
          <div className={`grid-period ${p === s.lunchAfter ? 'lunch' : ''}`}>{p}</div>
          {s.days.map((_, d) => {
            const exists = p <= s.periodsPerDay[d];
            const units = exists ? unitsAt(index, kind, id, d, p) : [];
            const starting = units.filter((u) => u.placement!.period === p);
            const hint = hints.get(`${d}-${p}`);
            const cls = [
              'cell',
              exists ? '' : 'none',
              p === s.lunchAfter ? 'lunch' : '',
              unavailable.has(`${d}-${p}`) ? 'unavailable' : '',
              hint ? `hint-${hint.state}` : '',
            ].join(' ');
            return (
              <div
                key={d}
                className={cls}
                title={hint?.reasons.join('\n') || (unavailable.has(`${d}-${p}`) ? '수업 불가 시간' : undefined)}
                onDragOver={(e) => {
                  if (editable && exists && dragUnit) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (editable && exists) drop(d, p);
                }}
              >
                {starting.map((u) => (
                  <UnitCard
                    key={u.id}
                    unit={u}
                    kind={kind}
                    id={id}
                    editable={editable}
                    conflict={analysis.conflictUnits.has(u.id)}
                    setDragId={setDragId}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
