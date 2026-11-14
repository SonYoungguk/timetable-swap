import { useState } from 'react';
import type { EntityKind } from '../../shared/model.ts';
import { getSettings } from '../../shared/types.ts';
import { TimetableGrid } from '../Grid.tsx';
import { useStore } from '../store.ts';
import { KIND_LABEL, entitiesOf } from '../ui.tsx';
import { EntityPicker, Overview } from './SchedulePage.tsx';

type View = EntityKind | 'all-class' | 'all-teacher';

/** 읽기 전용 조회 화면. 로그인하지 않은 사람에게는 이 화면만 보인다. */
export function ViewPage() {
  const db = useStore((s) => s.db);
  const [view, setView] = useState<View>('class');
  const [ids, setIds] = useState<Record<EntityKind, string>>({ class: '', teacher: '', room: '' });
  const single = view === 'class' || view === 'teacher' || view === 'room' ? view : null;
  const list = single ? entitiesOf(db, single) : [];
  const currentId = single ? (list.some((e) => e.id === ids[single]) ? ids[single] : (list[0]?.id ?? '')) : '';
  const go = (kind: EntityKind, id: string) => {
    setIds((x) => ({ ...x, [kind]: id }));
    setView(kind);
  };
  const name = list.find((e) => e.id === currentId)?.name ?? '';
  return (
    <div className="page view">
      <div className="toolbar no-print">
        <div className="seg">
          {(['class', 'teacher', 'room', 'all-class', 'all-teacher'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v === 'all-class' ? '전체(학급)' : v === 'all-teacher' ? '전체(교사)' : KIND_LABEL[v as EntityKind] + '별'}
            </button>
          ))}
        </div>
        {single && <EntityPicker kind={single} id={currentId} onChange={(id) => go(single, id)} />}
        <span className="spacer" />
        <button onClick={() => window.print()}>인쇄</button>
      </div>
      <div className="panel">
        <h2 className="view-title">
          {getSettings(db).schoolName} {single ? `${name} 시간표` : view === 'all-class' ? '학급 전체 시간표' : '교사 전체 시간표'}
        </h2>
        {single && currentId && <TimetableGrid kind={single} id={currentId} editable={false} />}
        {single && !currentId && <div className="empty">아직 등록된 시간표가 없습니다.</div>}
        {view === 'all-class' && <Overview kind="class" onPick={(id) => go('class', id)} />}
        {view === 'all-teacher' && <Overview kind="teacher" onPick={(id) => go('teacher', id)} />}
      </div>
    </div>
  );
}
