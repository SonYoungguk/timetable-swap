// 교실 배정 로직 검사: 예시 학교에서 교실을 비운 뒤 다시 배정해 본다.
import { demoDb } from '../shared/demo.ts';
import { applyTeacherRooms, autoAssignRooms, roomIssues } from '../shared/rooms.ts';

const db = demoDb();
let cleared = 0;
for (const l of Object.values(db.lessons))
  for (const p of l.parts)
    if (db.subjects[p.subjectId]?.roomKind) {
      p.roomId = null;
      cleared++;
    }
const before = roomIssues(db, () => '').length;
const r = autoAssignRooms(db);
for (const l of r.lessons) db.lessons[l.id] = l;
const kindOk = Object.values(db.lessons).every((l) => l.parts.every((p) => !db.subjects[p.subjectId]?.roomKind || (p.roomId && db.rooms[p.roomId].kind === db.subjects[p.subjectId].roomKind)));
console.log(`교실 비움 ${cleared}, 점검 ${before}건 → 자동 배정 ${r.assigned} (실패 ${r.failed}), 종류 일치 ${kindOk}`);

const t = Object.values(db.teachers)[0];
t.roomId = Object.values(db.rooms).find((x) => x.kind === '선택교실')!.id;
const mine = Object.values(db.lessons).flatMap((l) => l.parts).filter((p) => p.teacherId === t.id && !p.roomId).length;
const h = applyTeacherRooms(db);
console.log(`전용 교실: 대상 ${mine}, 적용 ${h.assigned}`);
if (r.assigned !== cleared || !kindOk || h.assigned !== mine || mine === 0) process.exit(1);
