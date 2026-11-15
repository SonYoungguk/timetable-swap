// Supabase 를 저장소로 쓰는 방식: 화면은 정적 호스팅(GitHub Pages)에 두고
// 저장·로그인·실시간 반영을 Supabase 가 맡는다.

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { COLLECTIONS, emptyDb } from '../shared/types.ts';
import type { CollectionName, Db, Op } from '../shared/types.ts';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
export const SUPABASE = !!URL && !!KEY;

let client: SupabaseClient | null = null;
const supa = () => (client ??= createClient(URL!, KEY!));

interface Row {
  collection: string;
  id: string;
  data: { id: string } & Record<string, unknown>;
  client?: string | null;
}

async function isAdmin(): Promise<boolean> {
  const { data: session } = await supa().auth.getSession();
  if (!session.session) return false;
  const { data } = await supa().rpc('is_admin');
  return data === true;
}

/** 담당자는 전체 자료를, 그 밖의 사람은 공개본과 날짜별 변경만 받는다 (서버의 권한 규칙이 걸러 준다). */
export async function loadState(): Promise<{ db: Db; admin: boolean }> {
  const admin = await isAdmin();
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa().from('docs').select('collection,id,data').order('collection').order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }
  const db = emptyDb();
  for (const r of rows) if (COLLECTIONS.includes(r.collection as CollectionName)) (db[r.collection as CollectionName] as Record<string, unknown>)[r.id] = r.data;
  if (admin) return { db, admin };
  // 비로그인: 공개본을 펼쳐 조회 화면이 바로 쓸 수 있게 한다.
  const pub = db.public.main;
  return { db: pub ? { ...emptyDb(), ...pub.snapshot, changes: db.changes } : emptyDb(), admin };
}

export async function pushOps(ops: Op[], clientId: string): Promise<void> {
  const { error } = await supa().rpc('apply_ops', { ops, client: clientId });
  if (error) throw new Error(error.code === '42501' ? '편집 권한이 없습니다. 다시 로그인해 주세요.' : `저장하지 못했습니다. (${error.message})`);
}

/** 다른 사람이 바꾼 내용을 받는다. 덩치가 큰 게시본이 바뀌면 통째로 다시 받는다. */
export function subscribe(clientId: string, admin: boolean, onOps: (ops: Op[]) => void, onReload: () => void): () => void {
  let dropped = false;
  let caughtUp = false;
  const channel = supa()
    .channel(`docs-${clientId}-${admin ? 'a' : 'g'}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, (payload) => {
      const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Partial<Row>;
      const collection = row.collection as CollectionName | undefined;
      if (!collection || !row.id || !COLLECTIONS.includes(collection)) return;
      if (row.client === clientId && payload.eventType !== 'DELETE') return;
      if (collection === 'public' || collection === 'published') return onReload();
      if (!admin && collection !== 'changes') return;
      if (payload.eventType === 'DELETE') onOps([{ op: 'del', collection, id: row.id }]);
      else if (row.data) onOps([{ op: 'put', collection, doc: row.data }]);
      else onReload();
    })
    // 구독이 실제로 시작된 시점. 처음 불러온 뒤 여기까지 사이에 바뀐 내용을 놓치지 않도록 한 번 더 받는다.
    .on('system', {}, (msg: { extension?: string; status?: string }) => {
      if (msg.extension === 'postgres_changes' && msg.status === 'ok' && !caughtUp) {
        caughtUp = true;
        if (!admin) onReload();
      }
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') dropped = true;
      else if (status === 'SUBSCRIBED' && dropped) {
        dropped = false;
        onReload();
      }
    });
  // 휴대폰은 화면이 꺼지면 연결이 끊기므로, 조회 화면은 다시 볼 때 최신으로 맞춘다.
  const onVisible = () => !admin && document.visibilityState === 'visible' && onReload();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    void supa().removeChannel(channel);
  };
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supa().auth.signInWithPassword({ email, password });
  if (error) return error.message === 'Email not confirmed' ? '메일로 받은 확인 링크를 먼저 눌러 주세요.' : '이메일 또는 비밀번호가 맞지 않습니다.';
  // 담당자가 아직 없으면 처음 로그인한 사람이 담당자가 된다.
  const { data } = await supa().rpc('claim_admin');
  if (data !== true) {
    await supa().auth.signOut();
    return '이 계정은 편성 담당자로 등록되어 있지 않습니다.';
  }
  return null;
}

/** 계정 만들기. 메일 확인이 필요하면 'confirm' 을 돌려준다. */
export async function signUp(email: string, password: string): Promise<{ error: string | null; confirm: boolean }> {
  const { data, error } = await supa().auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) return { error: error.message.includes('at least') ? '비밀번호가 너무 짧습니다.' : `계정을 만들지 못했습니다. (${error.message})`, confirm: false };
  return { error: null, confirm: !data.session };
}

export async function signOut(): Promise<void> {
  await supa().auth.signOut();
}
