import { useEffect, useState } from 'react';
import { SNAPSHOT, getSettings } from '../shared/types.ts';
import { guestSnapshot } from '../shared/types.ts';
import type { Db, Op, PublicView, Published } from '../shared/types.ts';
import { SUPABASE, signUp } from './supa.ts';
import { ChangesPage } from './pages/ChangesPage.tsx';
import { RoomsPage } from './pages/RoomsPage.tsx';
import { StudentsPage } from './pages/StudentsPage.tsx';
import { LessonsPage } from './pages/LessonsPage.tsx';
import { SchedulePage } from './pages/SchedulePage.tsx';
import { SetupPage } from './pages/SetupPage.tsx';
import { ViewPage } from './pages/ViewPage.tsx';
import { STATIC, connectEvents, useAnalysis, useStore } from './store.ts';
import { Modal } from './ui.tsx';

const PAGES = [
  ['setup', '① 기초 자료'],
  ['lessons', '② 수업 배정'],
  ['schedule', '③ 시간표 편성'],
  ['students', '학생·수강'],
  ['rooms', '교실'],
  ['changes', '수업 교체'],
  ['view', '조회·인쇄'],
] as const;
type PageKey = (typeof PAGES)[number][0];

function LoginDialog(props: { onClose: () => void }) {
  const login = useStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setMsg(null);
    if (mode === 'signup') {
      const r = await signUp(email.trim(), pw);
      if (r.error) setMsg(r.error);
      else if (r.confirm) {
        setMsg('확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 여기서 로그인해 주세요.');
        setMode('login');
      } else {
        const error = await login(pw, email.trim());
        if (error) setMsg(error);
        else props.onClose();
      }
    } else {
      const error = await login(pw, email.trim());
      if (error) setMsg(error);
      else props.onClose();
    }
    setBusy(false);
  };
  return (
    <Modal title={mode === 'signup' ? '편성 담당자 계정 만들기' : '편성 담당자 로그인'} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {SUPABASE && (
          <label>
            이메일
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          </label>
        )}
        <label>
          {SUPABASE ? '비밀번호' : '관리자 비밀번호'}
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus={!SUPABASE} required minLength={SUPABASE && mode === 'signup' ? 8 : undefined} />
        </label>
        {msg && <p className="warn">{msg}</p>}
        {SUPABASE && (
          <p className="muted" style={{ fontSize: 13 }}>
            {mode === 'login' ? (
              <>
                처음이신가요?{' '}
                <a href="#" onClick={(e) => (e.preventDefault(), setMode('signup'), setMsg(null))}>
                  계정 만들기
                </a>{' '}
                — 가장 먼저 로그인한 계정이 편성 담당자가 됩니다.
              </>
            ) : (
              <a href="#" onClick={(e) => (e.preventDefault(), setMode('login'), setMsg(null))}>
                이미 계정이 있습니다
              </a>
            )}
          </p>
        )}
        <div className="actions">
          <button type="button" onClick={props.onClose}>
            취소
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {mode === 'signup' ? '계정 만들기' : '로그인'}
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
    // 로그인하지 않은 사람이 받는 공개본은 학생 이름 등을 뺀 것을 따로 둔다.
    const open: PublicView = { id: 'main', publishedAt: doc.publishedAt, snapshot: guestSnapshot(snapshot) };
    const ops: Op[] = [
      { op: 'put', collection: 'published', doc: doc as unknown as { id: string } & Record<string, unknown> },
      { op: 'put', collection: 'public', doc: open as unknown as { id: string } & Record<string, unknown> },
    ];
    mutate(ops, 'skip');
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
        {STATIC ? null : admin ? <button onClick={() => void logout()}>로그아웃</button> : <button onClick={() => setLoginOpen(true)}>편성 담당자 로그인</button>}
      </header>
      {STATIC && (
        <div className="static-note no-print">
          <b>혼자 쓰는 모드</b> — 서버 없이 열려 있어 자료가 <b>이 브라우저에만</b> 저장되고 다른 사람에게는 보이지 않습니다. 기초 자료 → 학교 설정에서
          파일로 내보내 백업해 두세요.
        </div>
      )}
      {error && (
        <div className="error no-print" role="alert">
          {error} <button onClick={() => setError(null)}>닫기</button>
        </div>
      )}
      {current === 'setup' && <SetupPage />}
      {current === 'lessons' && <LessonsPage />}
      {current === 'schedule' && <SchedulePage />}
      {current === 'students' && <StudentsPage />}
      {current === 'rooms' && <RoomsPage />}
      {current === 'changes' && <ChangesPage />}
      {current === 'view' && <ViewPage />}
      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} />}
    </>
  );
}
