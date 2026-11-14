// 예시 학교로 자동 편성을 돌려 보고 결과가 유효한지 독립적으로 검사한다.
import { demoDb } from '../shared/demo.ts';
import { analyze, buildIndex, lessonHours } from '../shared/model.ts';
import { solve } from '../shared/solver.ts';

const db = demoDb();
const hoursByClass = new Map<string, number>();
for (const l of Object.values(db.lessons)) for (const c of l.classIds) hoursByClass.set(c, (hoursByClass.get(c) ?? 0) + lessonHours(l));
console.log('교사', Object.keys(db.teachers).length, '수업', Object.keys(db.lessons).length);
console.log('학급별 시수', [...new Set(hoursByClass.values())]);

const timeMs = Number(process.argv[2] ?? 8000);
const t0 = Date.now();
const r = solve(db, { mode: 'all', timeMs, seed: Number(process.argv[3] ?? 1) });
for (const [id, pos] of Object.entries(r.placed)) {
  const [lessonId, idx] = id.split(':');
  db.placements[id] = { id, lessonId, idx: Number(idx), day: pos.day, period: pos.period, pinned: db.placements[id]?.pinned ?? false };
}
const a = analyze(db, buildIndex(db));
console.log(`시간 ${Date.now() - t0}ms, 반복 ${r.iterations}, 미배치 ${r.unplaced.length}, 충돌 ${a.conflicts.length}, 권장위반 ${a.warnings.length}, soft ${r.soft}`);
a.conflicts.slice(0, 5).forEach((c) => console.log('  충돌:', c.message));
a.warnings.slice(0, 8).forEach((c) => console.log('  권장:', c.message));
if (a.conflicts.length || a.unplaced !== r.unplaced.length) process.exit(1);
