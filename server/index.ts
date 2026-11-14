// 저장(SQLite) · 로그인 · 변경 사항 실시간 전파(SSE) · 화면 파일 제공을 맡는 서버.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { COLLECTIONS, emptyDb } from '../shared/types.ts';
import type { CollectionName, Db, Op } from '../shared/types.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = resolve(process.env.DB_PATH ?? 'data/timetable.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

let adminPassword = process.env.ADMIN_PASSWORD ?? '';
if (!adminPassword) {
  adminPassword = randomBytes(6).toString('base64url');
  console.log(`\n  ADMIN_PASSWORD 가 설정되지 않아 임시 관리자 비밀번호를 만들었습니다: ${adminPassword}\n`);
}

const sql = new DatabaseSync(DB_PATH);
sql.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS docs (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  );
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
`);
const putStmt = sql.prepare(
  'INSERT INTO docs (collection, id, data) VALUES (?, ?, ?) ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data',
);
const delStmt = sql.prepare('DELETE FROM docs WHERE collection = ? AND id = ?');
const allStmt = sql.prepare('SELECT collection, id, data FROM docs');
const sessionGet = sql.prepare('SELECT token FROM sessions WHERE token = ?');
const sessionPut = sql.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)');
const sessionDel = sql.prepare('DELETE FROM sessions WHERE token = ?');

function loadAll(): Db {
  const db = emptyDb();
  for (const row of allStmt.all() as { collection: string; id: string; data: string }[]) {
    if (!COLLECTIONS.includes(row.collection as CollectionName)) continue;
    (db[row.collection as CollectionName] as Record<string, unknown>)[row.id] = JSON.parse(row.data);
  }
  return db;
}

function validOps(ops: unknown): ops is Op[] {
  if (!Array.isArray(ops) || ops.length > 20000) return false;
  return ops.every((o) => {
    if (!o || typeof o !== 'object' || !COLLECTIONS.includes(o.collection)) return false;
    if (o.op === 'del') return typeof o.id === 'string' && o.id.length > 0 && o.id.length < 100;
    if (o.op === 'put')
      return !!o.doc && typeof o.doc === 'object' && typeof o.doc.id === 'string' && o.doc.id.length > 0 && o.doc.id.length < 100;
    return false;
  });
}

type Listener = (payload: string) => void;
const listeners = new Set<Listener>();

const app = new Hono();
const SESSION_COOKIE = 'tt_session';
const isAdmin = (token: string | undefined) => !!token && !!sessionGet.get(token);

app.get('/api/state', (c) => c.json({ db: loadAll(), admin: isAdmin(getCookie(c, SESSION_COOKIE)) }));

app.post('/api/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const given = Buffer.from(String(body.password ?? ''));
  const want = Buffer.from(adminPassword);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return c.json({ error: '비밀번호가 맞지 않습니다.' }, 401);
  const token = randomBytes(24).toString('base64url');
  sessionPut.run(token, Date.now());
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return c.json({ ok: true });
});

app.post('/api/logout', (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) sessionDel.run(token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.post('/api/batch', async (c) => {
  if (!isAdmin(getCookie(c, SESSION_COOKIE))) return c.json({ error: '편집 권한이 없습니다. 다시 로그인해 주세요.' }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body || !validOps(body.ops)) return c.json({ error: '잘못된 요청입니다.' }, 400);
  const ops: Op[] = body.ops;
  sql.exec('BEGIN');
  try {
    for (const op of ops) {
      if (op.op === 'put') putStmt.run(op.collection, op.doc.id, JSON.stringify(op.doc));
      else delStmt.run(op.collection, op.id);
    }
    sql.exec('COMMIT');
  } catch (e) {
    sql.exec('ROLLBACK');
    console.error(e);
    return c.json({ error: '저장하지 못했습니다.' }, 500);
  }
  const payload = JSON.stringify({ clientId: String(body.clientId ?? ''), ops });
  for (const l of listeners) l(payload);
  return c.json({ ok: true });
});

// 다른 사람이 바꾼 내용을 열려 있는 모든 화면에 바로 보낸다.
app.get('/api/events', (c) =>
  streamSSE(c, async (stream) => {
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    const listener: Listener = (payload) => {
      queue.push(payload);
      wake?.();
    };
    listeners.add(listener);
    stream.onAbort(() => {
      listeners.delete(listener);
      wake?.();
    });
    try {
      while (!stream.aborted) {
        while (queue.length) await stream.writeSSE({ event: 'ops', data: queue.shift()! });
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 25000);
        });
        wake = null;
        if (!stream.aborted && !queue.length) await stream.writeSSE({ event: 'ping', data: '' });
      }
    } finally {
      listeners.delete(listener);
    }
  }),
);

if (existsSync('dist/index.html')) {
  app.use('/*', serveStatic({ root: './dist' }));
  const html = readFileSync('dist/index.html', 'utf8');
  app.get('*', (c) => c.html(html));
}

serve({ fetch: app.fetch, port: PORT }, () => console.log(`시간표 서버: http://localhost:${PORT}`));
