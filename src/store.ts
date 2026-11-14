import { create } from 'zustand';
import { analyze, buildIndex } from '../shared/model.ts';
import type { Analysis, Index } from '../shared/model.ts';
import { applyOps, emptyDb, publishedView } from '../shared/types.ts';
import type { Db, Op } from '../shared/types.ts';

const clientId = Math.random().toString(36).slice(2);
export const newId = () => Math.random().toString(36).slice(2, 10);

interface Store {
  db: Db;
  admin: boolean;
  loaded: boolean;
  error: string | null;
  undoStack: Op[][];
  redoStack: Op[][];
  load: () => Promise<void>;
  mutate: (ops: Op[], record?: 'undo' | 'redo' | 'none' | 'skip') => void;
  undo: () => void;
  redo: () => void;
  login: (password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  setError: (e: string | null) => void;
}

function invert(db: Db, ops: Op[]): Op[] {
  const inverse: Op[] = [];
  let cur = db;
  for (const op of ops) {
    const id = op.op === 'put' ? op.doc.id : op.id;
    const old = (cur[op.collection] as Record<string, unknown>)[id] as ({ id: string } & Record<string, unknown>) | undefined;
    if (old) inverse.push({ op: 'put', collection: op.collection, doc: old });
    else if (op.op === 'put') inverse.push({ op: 'del', collection: op.collection, id });
    cur = applyOps(cur, [op]);
  }
  return inverse.reverse();
}

// 서버 저장은 순서대로 하나씩 보낸다.
let chain: Promise<void> = Promise.resolve();

export const useStore = create<Store>((set, get) => ({
  db: emptyDb(),
  admin: false,
  loaded: false,
  error: null,
  undoStack: [],
  redoStack: [],

  load: async () => {
    try {
      const res = await fetch('/api/state');
      const body = await res.json();
      set({ db: body.db, admin: body.admin, loaded: true, undoStack: [], redoStack: [] });
    } catch {
      set({ error: '서버에 연결하지 못했습니다.', loaded: true });
    }
  },

  mutate: (ops, record = 'undo') => {
    if (!ops.length) return;
    const { db, undoStack, redoStack } = get();
    const inverse = invert(db, ops);
    set({
      db: applyOps(db, ops),
      undoStack: record === 'redo' ? undoStack : record === 'undo' || record === 'none' ? [...undoStack.slice(-99), inverse] : undoStack,
      redoStack: record === 'redo' ? [...redoStack, inverse] : record === 'undo' ? [] : redoStack,
    });
    chain = chain.then(async () => {
      try {
        const res = await fetch('/api/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, ops }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '저장하지 못했습니다.');
      } catch (e) {
        // 저장에 실패하면 화면을 서버 상태로 되돌린다.
        await get().load();
        set({ error: e instanceof Error ? e.message : '저장하지 못했습니다.' });
      }
    });
  },

  undo: () => {
    const { undoStack } = get();
    const ops = undoStack[undoStack.length - 1];
    if (!ops) return;
    set({ undoStack: undoStack.slice(0, -1) });
    get().mutate(ops, 'redo');
  },

  redo: () => {
    const { redoStack } = get();
    const ops = redoStack[redoStack.length - 1];
    if (!ops) return;
    set({ redoStack: redoStack.slice(0, -1) });
    get().mutate(ops, 'none');
  },

  login: async (password) => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) return (await res.json().catch(() => ({}))).error ?? '로그인하지 못했습니다.';
    await get().load();
    return null;
  },

  logout: async () => {
    await fetch('/api/logout', { method: 'POST' });
    await get().load();
  },

  setError: (error) => set({ error }),
}));

/** 다른 화면에서 바꾼 내용을 받아 반영한다. */
export function connectEvents() {
  const es = new EventSource('/api/events');
  let dropped = false;
  es.addEventListener('ops', (e) => {
    const msg = JSON.parse((e as MessageEvent).data);
    if (msg.clientId === clientId) return;
    useStore.setState((s) => ({ db: applyOps(s.db, msg.ops) }));
  });
  es.addEventListener('reload', () => void useStore.getState().load());
  es.onerror = () => {
    dropped = true;
  };
  es.onopen = () => {
    // 끊겼다 다시 붙으면 그 사이 변경을 놓쳤을 수 있으니 전체를 다시 받는다.
    if (dropped) {
      dropped = false;
      void useStore.getState().load();
    }
  };
  return () => es.close();
}

let memoDb: Db | null = null;
let memoIndex: Index | null = null;
let memoAnalysis: Analysis | null = null;
function ensure(db: Db) {
  if (memoDb !== db) {
    memoDb = db;
    memoIndex = buildIndex(db);
    memoAnalysis = analyze(db, memoIndex);
  }
}
export function useIndex(): Index {
  const db = useStore((s) => s.db);
  ensure(db);
  return memoIndex!;
}
export function useAnalysis(): Analysis {
  const db = useStore((s) => s.db);
  ensure(db);
  return memoAnalysis!;
}

let memoPubKey: unknown[] = [];
let memoPub: Db | null = null;
/** 조회·교체 화면이 쓰는 게시된 시간표(+날짜별 변경). 게시 전이면 null. */
export function usePub(): Db | null {
  const db = useStore((s) => s.db);
  const admin = useStore((s) => s.admin);
  // 비로그인 화면은 서버가 이미 게시본만 내려 준다.
  if (!admin) return Object.keys(db.classes).length ? db : null;
  const key = [db.published, db.changes];
  if (key.some((k, i) => k !== memoPubKey[i])) {
    memoPubKey = key;
    memoPub = publishedView(db);
  }
  return memoPub;
}
