import { useMemo, useState } from 'react';
import { sortedByName } from '../../shared/model.ts';
import { applyTeacherRooms, autoAssignRooms, roomIssues, roomUsage } from '../../shared/rooms.ts';
import type { AssignResult } from '../../shared/rooms.ts';
import type { Op } from '../../shared/types.ts';
import { useStore } from '../store.ts';
import { classesLabel } from '../ui.tsx';
import { Overview } from './SchedulePage.tsx';

/** 교과교실제: 교실 자동 배정, 사용 현황, 점검 */
export function RoomsPage() {
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const [message, setMessage] = useState<string | null>(null);
  const usage = useMemo(() => new Map(roomUsage(db).map((u) => [u.roomId, u])), [db]);
  const issues = useMemo(
    () => roomIssues(db, (l, i) => `${classesLabel(db, l.classIds)} ${db.subjects[l.parts[i].subjectId]?.name ?? '?'}`),
    [db],
  );
  const rooms = sortedByName(db.rooms);
  const noRoom = Object.values(db.lessons).reduce((n, l) => n + l.parts.filter((p) => !p.roomId).length, 0);

  const run = (result: AssignResult, what: string) => {
    const ops: Op[] = result.lessons.map((l) => ({ op: 'put', collection: 'lessons', doc: l as unknown as { id: string } & Record<string, unknown> }));
    mutate(ops);
    setMessage(
      result.assigned
        ? `${what}: 강좌 ${result.assigned}개에 교실을 배정했습니다.${result.failed ? ` ${result.failed}개는 맞는 빈 교실이 없어 그대로 두었습니다.` : ''}`
        : `${what}: 새로 배정할 강좌가 없습니다.${result.failed ? ` (${result.failed}개는 맞는 빈 교실이 없음)` : ''}`,
    );
  };

  return (
    <div className="page">
      <div className="toolbar">
        <button onClick={() => run(applyTeacherRooms(db), '교사 전용 교실 적용')} title="교실이 비어 있는 수업에 담당 교사의 전용 교실을 넣습니다">
          교사 전용 교실 적용
        </button>
        <button className="primary" onClick={() => run(autoAssignRooms(db), '교실 자동 배정')} title="교실 종류가 필요한 과목에 비어 있는 알맞은 교실을 배정합니다">
          교실 자동 배정
        </button>
        <span className="muted">교실이 정해지지 않은 강좌 {noRoom}개 (학급 교실 수업 포함)</span>
      </div>
      {message && <div className="panel note">{message} <small>기초 자료나 시간표 편성 화면의 실행 취소로 되돌릴 수 있습니다.</small></div>}

      <div className="panel">
        <div className="label">
          교실 사용 현황 <small className="muted">— 교사 전용 교실은 기초 자료 → 교사, 과목에 필요한 교실 종류는 기초 자료 → 과목에서 정합니다.</small>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>교실</th>
              <th>종류</th>
              <th>수용</th>
              <th>전용 교사</th>
              <th>배정 시수</th>
              <th style={{ width: '34%' }}>가동률 (시간표에 놓인 칸 / 한 주 전체 칸)</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => {
              const u = usage.get(r.id)!;
              const pct = u.total ? Math.round((u.placed / u.total) * 100) : 0;
              const owners = Object.values(db.teachers).filter((t) => t.roomId === r.id).map((t) => t.name);
              return (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.kind}</td>
                  <td>{r.capacity ? `${r.capacity}명` : '-'}</td>
                  <td>{owners.join(', ') || '-'}</td>
                  <td className={u.hours > u.total ? 'warn' : ''}>
                    {u.hours}시간{u.hours > u.total && ' (한 주 칸 수 초과)'}
                  </td>
                  <td>
                    <div className="usage">
                      <div className="bar">
                        <div style={{ width: `${pct}%` }} />
                      </div>
                      <span>
                        {u.placed}/{u.total} · {pct}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rooms.length && <div className="empty">등록된 교실이 없습니다. 기초 자료 → 교실에서 추가해 주세요.</div>}
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="label">점검 {issues.length}건</div>
        {issues.length ? (
          <ul className="change-list">
            {issues.slice(0, 100).map((x, i) => (
              <li key={i}>{x.message}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">교실 종류와 수용 인원에 문제가 없습니다.</p>
        )}
      </div>

      {rooms.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Overview kind="room" />
        </div>
      )}
    </div>
  );
}
