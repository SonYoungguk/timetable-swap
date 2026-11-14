import { useEffect, useRef, useState } from 'react';
import { unitsAt } from '../../shared/model.ts';
import type { EntityKind } from '../../shared/model.ts';
import type { SolveProgress, SolveResult } from '../../shared/solver.ts';
import type { Db, Op, Placement } from '../../shared/types.ts';
import { clearPlacements } from '../actions.ts';
import { TimetableGrid, UnitCard } from '../Grid.tsx';
import { useAnalysis, useIndex, useStore } from '../store.ts';
import { KIND_LABEL, Modal, cardInfo, entitiesOf, unplacedUnits } from '../ui.tsx';

type View = EntityKind | 'all-class' | 'all-teacher';

export function EntityPicker(props: {
  kind: EntityKind;
  id: string;
  onChange: (id: string) => void;
  db?: Db;
}) {
  const own = useStore((s) => s.db);
  const list = entitiesOf(props.db ?? own, props.kind);
  const i = list.findIndex((e) => e.id === props.id);
  const step = (n: number) => list.length && props.onChange(list[(i + n + list.length) % list.length].id);
  return (
    <span className="picker">
      <button onClick={() => step(-1)} aria-label="이전">
        ◀
      </button>
      <select value={props.id} onChange={(e) => props.onChange(e.target.value)}>
        {list.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <button onClick={() => step(1)} aria-label="다음">
        ▶
      </button>
    </span>
  );
}

/** 모든 학급(또는 교사)의 한 주를 한 표로 본다. */
export function Overview(props: { kind: EntityKind; onPick?: (id: string) => void }) {
  const db = useStore((s) => s.db);
  const index = useIndex();
  const analysis = useAnalysis();
  const s = index.settings;
  const rows = entitiesOf(db, props.kind);
  return (
    <div className="overview-wrap">
      <table className="overview">
        <thead>
          <tr>
            <th rowSpan={2}>{KIND_LABEL[props.kind]}</th>
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
          {rows.map((r) => (
            <tr key={r.id}>
              <th className="row-head" onClick={() => props.onPick?.(r.id)}>
                {r.name}
              </th>
              {s.days.flatMap((_, di) =>
                Array.from({ length: s.periodsPerDay[di] }, (_, i) => {
                  const units = unitsAt(index, props.kind, r.id, di, i + 1);
                  const u = units[0];
                  const info = u ? cardInfo(db, u.lesson, props.kind, r.id) : null;
                  const bad = units.length > 1 || units.some((x) => analysis.conflictUnits.has(x.id));
                  return (
                    <td
                      key={`${di}-${i}`}
                      className={`${i === 0 ? 'day-start' : ''} ${bad ? 'bad' : ''}`}
                      style={{ background: info?.color }}
                      title={info ? [info.title, ...info.lines].join(' · ') : undefined}
                    >
                      {info ? (props.kind === 'teacher' ? (info.lines[0] ?? info.title) : info.title.replace(/^\d+학년\s*/, '')) : ''}
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

function AutoDialog(props: { onClose: () => void }) {
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const index = useIndex();
  const [mode, setMode] = useState<'fill' | 'all'>('all');
  const [seconds, setSeconds] = useState(15);
  const [progress, setProgress] = useState<SolveProgress | null>(null);
  const [result, setResult] = useState<SolveResult | null>(null);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);

  const placedCount = Object.keys(db.placements).length;
  const pinnedCount = Object.values(db.placements).filter((p) => p.pinned).length;

  const run = () => {
    setResult(null);
    setProgress({ ratio: 0, hard: 0, soft: 0 });
    const w = new Worker(new URL('../solver.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e) => {
      if (e.data.type === 'progress') setProgress(e.data.progress);
      else {
        setResult(e.data.result);
        setProgress(null);
        w.terminate();
      }
    };
    w.postMessage({ db, mode, timeMs: seconds * 1000 });
  };

  const apply = () => {
    if (!result) return;
    const ops: Op[] = [];
    for (const [id, pos] of Object.entries(result.placed)) {
      const unit = index.units.get(id);
      if (!unit) continue;
      const old = db.placements[id];
      if (old && old.day === pos.day && old.period === pos.period) continue;
      const doc: Placement = { id, lessonId: unit.lesson.id, idx: unit.idx, day: pos.day, period: pos.period, pinned: old?.pinned ?? false };
      ops.push({ op: 'put', collection: 'placements', doc: doc as unknown as { id: string } & Record<string, unknown> });
    }
    for (const id of result.unplaced) if (db.placements[id]) ops.push({ op: 'del', collection: 'placements', id });
    mutate(ops);
    props.onClose();
  };

  return (
    <Modal title="자동 편성" onClose={props.onClose}>
      {!progress && !result && (
        <div className="form">
          <label className="radio">
            <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} />
            <span>
              <b>전부 다시 짜기</b>
              <small>고정(📌)한 수업 {pinnedCount}개만 그대로 두고 나머지를 새로 배치합니다.</small>
            </span>
          </label>
          <label className="radio">
            <input type="radio" checked={mode === 'fill'} onChange={() => setMode('fill')} />
            <span>
              <b>빈 수업만 채우기</b>
              <small>이미 놓은 수업 {placedCount}개는 건드리지 않고 미배치 수업만 넣습니다.</small>
            </span>
          </label>
          <label>
            계산 시간
            <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
              <option value={5}>5초 (빠르게)</option>
              <option value={15}>15초</option>
              <option value={40}>40초 (더 꼼꼼히)</option>
              <option value={120}>2분</option>
            </select>
          </label>
          <p className="muted">
            교사·학급·교실이 겹치지 않고 수업 불가 시간을 피하도록 짭니다. 같은 수업이 하루에 몰리지 않게, 교사 하루 시수·연속
            수업이 설정한 권장값을 넘지 않게, 학급에 공강이 생기지 않게 다듬습니다.
          </p>
          <div className="actions">
            <button onClick={props.onClose}>취소</button>
            <button className="primary" onClick={run}>
              편성 시작
            </button>
          </div>
        </div>
      )}
      {progress && (
        <div className="form">
          <div className="bar">
            <div style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
          </div>
          <p>
            계산 중… 남은 충돌 {progress.hard}개 · 권장 사항 위반 점수 {progress.soft}
          </p>
          <div className="actions">
            <button onClick={props.onClose}>중단</button>
          </div>
        </div>
      )}
      {result && (
        <div className="form">
          <p>
            수업 {Object.keys(result.placed).length}개를 겹침 없이 배치했습니다.
            {result.unplaced.length > 0 ? (
              <b className="warn"> {result.unplaced.length}개는 자리를 찾지 못해 미배치로 남습니다.</b>
            ) : (
              ' 미배치 수업이 없습니다.'
            )}
          </p>
          <p className="muted">적용한 뒤에도 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.</p>
          <div className="actions">
            <button onClick={props.onClose}>버리기</button>
            <button onClick={run}>다시 계산</button>
            <button className="primary" onClick={apply}>
              시간표에 적용
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function SchedulePage() {
  const db = useStore((s) => s.db);
  const { undo, redo, undoStack, redoStack, mutate } = useStore();
  const index = useIndex();
  const analysis = useAnalysis();
  const [view, setView] = useState<View>('class');
  const [ids, setIds] = useState<Record<EntityKind, string>>({ class: '', teacher: '', room: '' });
  const [dragId, setDragId] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const single = view === 'class' || view === 'teacher' || view === 'room' ? view : null;
  const list = single ? entitiesOf(db, single) : [];
  const currentId = single ? (list.some((e) => e.id === ids[single]) ? ids[single] : (list[0]?.id ?? '')) : '';
  const go = (kind: EntityKind, id: string) => {
    setIds((x) => ({ ...x, [kind]: id }));
    setView(kind);
  };
  const tray = single && currentId ? unplacedUnits(index, single, currentId) : [];
  const total = index.units.size;

  return (
    <div className="page schedule">
      <div className="toolbar">
        <div className="seg">
          {(['class', 'teacher', 'room', 'all-class', 'all-teacher'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v === 'all-class' ? '전체(학급)' : v === 'all-teacher' ? '전체(교사)' : KIND_LABEL[v as EntityKind] + '별'}
            </button>
          ))}
        </div>
        {single && <EntityPicker kind={single} id={currentId} onChange={(id) => go(single, id)} />}
        <span className="spacer" />
        <button onClick={undo} disabled={!undoStack.length} title="실행 취소 (Ctrl+Z)">
          ↶ 취소
        </button>
        <button onClick={redo} disabled={!redoStack.length} title="다시 실행 (Ctrl+Shift+Z)">
          ↷ 다시
        </button>
        <button
          onClick={() => {
            if (confirm('고정한 수업만 남기고 시간표를 비울까요? (실행 취소로 되돌릴 수 있습니다)')) clearPlacements(true);
          }}
        >
          비우기
        </button>
        <button className="primary" onClick={() => setAuto(true)} disabled={!total}>
          ⚡ 자동 편성
        </button>
      </div>

      <div className="schedule-body">
        <div className="schedule-main">
          {total === 0 && (
            <div className="empty">
              아직 수업이 없습니다. <b>기초 자료</b>에서 교사·과목·학급을 넣고 <b>수업 배정</b>에서 수업을 만들어 주세요. 처음이라면 기초
              자료 → 학교 설정의 <b>예시 학교 불러오기</b>로 바로 써 볼 수 있습니다.
            </div>
          )}
          {single && currentId && (
            <>
              <TimetableGrid kind={single} id={currentId} editable dragId={dragId} setDragId={setDragId} />
              <div
                className={`tray ${dragId ? 'active' : ''}`}
                onDragOver={(e) => dragId && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && db.placements[dragId]) mutate([{ op: 'del', collection: 'placements', id: dragId }]);
                  setDragId(null);
                }}
              >
                <div className="tray-title">
                  미배치 수업 {tray.length}개 <small>— 시간표로 끌어다 놓으세요. 시간표의 수업을 여기로 끌면 빠집니다.</small>
                </div>
                <div className="tray-cards">
                  {tray.map((u) => (
                    <UnitCard key={u.id} unit={u} kind={single} id={currentId} editable setDragId={setDragId} />
                  ))}
                </div>
              </div>
              <p className="muted legend">
                끄는 동안 <span className="sw ok" /> 놓을 수 있음 <span className="sw swap" /> 서로 맞바꿈 <span className="sw bad" /> 겹침(칸에
                마우스를 올리면 이유 표시)
              </p>
            </>
          )}
          {single && !currentId && total > 0 && <div className="empty">{KIND_LABEL[single]} 자료가 없습니다.</div>}
          {view === 'all-class' && <Overview kind="class" onPick={(id) => go('class', id)} />}
          {view === 'all-teacher' && <Overview kind="teacher" onPick={(id) => go('teacher', id)} />}
        </div>

        <aside className="issues">
          <div className="stat-row">
            <span className={`stat ${analysis.conflicts.length ? 'red' : 'green'}`}>충돌 {analysis.conflicts.length}</span>
            <span className={`stat ${analysis.unplaced ? 'amber' : 'green'}`}>미배치 {analysis.unplaced}</span>
            <span className="stat">권장 {analysis.warnings.length}</span>
          </div>
          {analysis.conflicts.length > 0 && <h4>충돌 — 반드시 고쳐야 합니다</h4>}
          <ul>
            {analysis.conflicts.slice(0, 60).map((c, i) => (
              <li key={i} className="red" onClick={() => c.target && go(c.target.kind, c.target.id)}>
                {c.message}
              </li>
            ))}
          </ul>
          {analysis.warnings.length > 0 && <h4>권장 사항</h4>}
          <ul>
            {analysis.warnings.slice(0, 80).map((c, i) => (
              <li key={i} onClick={() => c.target && go(c.target.kind, c.target.id)}>
                {c.message}
              </li>
            ))}
          </ul>
          {total > 0 && !analysis.conflicts.length && !analysis.warnings.length && !analysis.unplaced && (
            <p className="muted">문제 없는 시간표입니다.</p>
          )}
        </aside>
      </div>
      {auto && <AutoDialog onClose={() => setAuto(false)} />}
    </div>
  );
}
