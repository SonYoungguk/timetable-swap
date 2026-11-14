import { useEffect, useState } from 'react';
import { SNAPSHOT, getSettings } from '../shared/types.ts';
import type { Db, Op, Published } from '../shared/types.ts';
import { ChangesPage } from './pages/ChangesPage.tsx';
import { LessonsPage } from './pages/LessonsPage.tsx';
import { SchedulePage } from './pages/SchedulePage.tsx';
import { SetupPage } from './pages/SetupPage.tsx';
import { ViewPage } from './pages/ViewPage.tsx';
import { connectEvents, useAnalysis, useStore } from './store.ts';
import { Modal } from './ui.tsx';

const PAGES = [
  ['setup', '① 기초 자료'],
  ['lessons', '② 수업 배정'],
  ['schedule', '③ 시간표 편성'],
  ['changes', '수업 교체'],
  ['view', '조회·인쇄'],
] as const;
type PageKey = (typeof PAGES)[number][0];

function LoginDialog(props: { onClose: () => void }) {
  const login = useStore((s) => s.login);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="편성 담당자 로그인" onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const error = await login(pw);
          if (error) setErr(error);
          else props.onClose();
        }}
      >
        <label>
          관리자 비밀번호
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </label>
        {err && <p className="warn">{err}</p>}
        <div className="actions">
          <button type="button" onClick={props.onClose}>
            취소
          </button>
          <button className="primary" type="submit">
            로그인
          </button>
        </div>
      </form>
    </Modal>
  );
}

let dirtyKey: Db | null = null;
let dirtyValue = false;
/** 편성 중인 안이 게시본과 다른지 */
function isDirty(db: Db): boolean {
  if (dirtyKey === db) return dirtyValue;
  dirtyKey = db;
  const snap = db.published.main?.snapshot;
  dirtyValue = !snap || SNAPSHOT.some((c) => JSON.stringify(snap[c] ?? {}) !== JSON.stringify(db[c]));
  return dirtyValue;
}

function PublishControl() {
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const analysis = useAnalysis();
  const pub = db.published.main;
  const dirty = isDirty(db);
  const publish = () => {
    const warn: string[] = [];
    if (analysis.conflicts.length) warn.push(`충돌 ${analysis.conflicts.length}건`);
    if (analysis.unplaced) warn.push(`미배치 수업 ${analysis.unplaced}개`);
    const msg = warn.length
      ? `아직 ${warn.join(', ')}이(가) 남아 있습니다. 그래도 지금 시간표를 게시할까요?`
      : '지금 편성한 시간표를 게시할까요? 학생·교사가 보는 조회 화면이 바로 바뀝니다.';
    if (!confirm(msg)) return;
    const snapshot = Object.fromEntries(SNAPSHOT.map((c) => [c, db[c]])) as Published['snapshot'];
    const doc: Published = { id: 'main', publishedAt: Date.now(), snapshot };
    const op: Op = { op: 'put', collection: 'published', doc: doc as unknown as { id: string } & Record<string, unknown> };
    mutate([op], 'skip');
  };
  return (
    <span className="publish">
      <small>
        {pub ? `${new Date(pub.publishedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })} 게시` : '게시 전'}
        {pub && dirty && ' · 이후 수정됨'}
      </small>
      <button className={dirty ? 'primary' : ''} disabled={!dirty} onClick={publish}>
        {pub ? '다시 게시' : '게시'}
      </button>
    </span>
  );
}

export function App() {
  const { db, admin, loaded, error, load, logout, setError } = useStore();
  const [page, setPage] = useState<PageKey>(() => (location.hash.slice(1) as PageKey) || 'schedule');
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);
  // 로그인 여부에 따라 서버가 보내 주는 범위가 달라지므로 다시 연결한다.
  useEffect(() => connectEvents(), [admin]);
  useEffect(() => {
    location.hash = page;
  }, [page]);

  if (!loaded) return <div className="loading">불러오는 중…</div>;
  const current: PageKey = admin && PAGES.some((p) => p[0] === page) ? page : 'view';

  return (
    <>
      <header className="top no-print">
        <h1>{getSettings(db).schoolName} 시간표</h1>
        <nav>
          {admin &&
            PAGES.map(([key, label]) => (
              <button key={key} className={current === key ? 'on' : ''} onClick={() => setPage(key)}>
                {label}
              </button>
            ))}
        </nav>
        <span className="spacer" />
        {admin && <PublishControl />}
        {admin ? <button onClick={() => void logout()}>로그아웃</button> : <button onClick={() => setLoginOpen(true)}>편성 담당자 로그인</button>}
      </header>
      {error && (
        <div className="error no-print" role="alert">
          {error} <button onClick={() => setError(null)}>닫기</button>
        </div>
      )}
      {current === 'setup' && <SetupPage />}
      {current === 'lessons' && <LessonsPage />}
      {current === 'schedule' && <SchedulePage />}
      {current === 'changes' && <ChangesPage />}
      {current === 'view' && <ViewPage />}
      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} />}
    </>
  );
}
