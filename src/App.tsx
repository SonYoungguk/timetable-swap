import { useEffect, useState } from 'react';
import { getSettings } from '../shared/types.ts';
import { LessonsPage } from './pages/LessonsPage.tsx';
import { SchedulePage } from './pages/SchedulePage.tsx';
import { SetupPage } from './pages/SetupPage.tsx';
import { ViewPage } from './pages/ViewPage.tsx';
import { connectEvents, useStore } from './store.ts';
import { Modal } from './ui.tsx';

const PAGES = [
  ['setup', '① 기초 자료'],
  ['lessons', '② 수업 배정'],
  ['schedule', '③ 시간표 편성'],
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

export function App() {
  const { db, admin, loaded, error, load, logout, setError } = useStore();
  const [page, setPage] = useState<PageKey>(() => (location.hash.slice(1) as PageKey) || 'schedule');
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    void load();
    return connectEvents();
  }, [load]);
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
      {current === 'view' && <ViewPage />}
      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} />}
    </>
  );
}
