// 예시 학교(3개 학년 × 6학급, 선택과목 묶음 포함)를 만든다. 처음 써 보는 사람과 솔버 테스트용.

import { defaultSettings, emptyDb } from './types.ts';
import type { Db, Lesson, LessonPart } from './types.ts';

const COLORS = [
  '#fde2e2', '#fdebd0', '#fff6bf', '#e2f5d3', '#d3f0ea', '#d6ebfb', '#e0e0fb', '#f1dcf7',
  '#fbdce9', '#e8e4d8', '#d9f2c4', '#c9ecf5', '#f7d9c4', '#dfe7f2', '#f5e6ff', '#e6f7e1',
];
const SURNAMES = '김이박최정강조윤장임한오서신권황안송류홍'.split('');
const GIVEN = ['민준', '서연', '도윤', '지우', '하준', '서현', '은우', '수아', '지호', '하은', '예준', '지민', '시우', '채원', '주원', '다은', '유준', '소율', '건우', '지안'];

export function demoDb(): Db {
  const db = emptyDb();
  db.settings.main = { ...defaultSettings(), schoolName: '예시고등학교' };
  let n = 0;
  const nid = (p: string) => `${p}${(++n).toString(36)}`;

  const subj = new Map<string, string>();
  const SHORT: Record<string, string> = {
    통합사회: '통사', 통합과학: '통과', 과학탐구실험: '과탐', '기술·가정': '기가', 자율활동: '자율', 동아리: '동아리',
    한국사: '한국사', 수학Ⅰ: '수Ⅰ', 수학Ⅱ: '수Ⅱ', 영어Ⅰ: '영Ⅰ', 영어Ⅱ: '영Ⅱ', '음악 감상과 비평': '음감', '미술 창작': '미창',
    '통합 논술': '논술', '진로 탐구': '진탐',
  };
  const subject = (name: string, short: string | undefined = SHORT[name]) => {
    let id = subj.get(name);
    if (!id) {
      id = nid('s');
      subj.set(name, id);
      db.subjects[id] = { id, name, short: short ?? name.slice(0, 2), color: COLORS[subj.size % COLORS.length] };
    }
    return id;
  };

  const room = (name: string, kind: string) => {
    const id = nid('r');
    db.rooms[id] = { id, name, kind, capacity: kind === '선택교실' ? 30 : 32 };
    return id;
  };
  const sci = [1, 2, 3, 4].map((i) => room(`과학실${i}`, '과학실'));
  const music = room('음악실', '음악실');
  const art = room('미술실', '미술실');
  const sel = [1, 2, 3, 4, 5, 6].map((i) => room(`선택교실${i}`, '선택교실'));

  const classes: string[][] = [[], [], []];
  for (let g = 1; g <= 3; g++)
    for (let c = 1; c <= 6; c++) {
      const id = nid('c');
      db.classes[id] = { id, grade: g, num: c, name: `${g}-${c}` };
      classes[g - 1].push(id);
    }

  // 교과별 교사: 시수가 넘치면 새 교사를 만든다.
  const pools = new Map<string, { id: string; load: number }[]>();
  const CAP = 16;
  const teacher = (dept: string, hours: number, exclude: Set<string> = new Set()) => {
    let pool = pools.get(dept);
    if (!pool) pools.set(dept, (pool = []));
    let t = pool.filter((x) => !exclude.has(x.id) && x.load + hours <= CAP).sort((a, b) => a.load - b.load)[0];
    if (!t) {
      const id = nid('t');
      const k = Object.keys(db.teachers).length;
      db.teachers[id] = { id, name: `${SURNAMES[k % SURNAMES.length]}${GIVEN[(k * 7 + Math.floor(k / SURNAMES.length) * 3) % GIVEN.length]}`, unavailable: [] };
      t = { id, load: 0 };
      pool.push(t);
    }
    t.load += hours;
    return t.id;
  };

  const lesson = (classIds: string[], parts: LessonPart[], blocks: number[], label = '') => {
    const id = nid('l');
    const l: Lesson = { id, label, classIds, parts, blocks };
    db.lessons[id] = l;
    return l;
  };
  const ones = (h: number) => Array.from({ length: h }, () => 1);
  const simple = (cls: string, name: string, dept: string, hours: number, roomId: string | null = null, blocks?: number[]) =>
    lesson([cls], [{ subjectId: subject(name), teacherId: teacher(dept, hours), roomId }], blocks ?? ones(hours));

  // 1학년: 공통 과목 (학급당 34시간)
  for (const c of classes[0]) {
    simple(c, '국어', '국어', 4);
    simple(c, '수학', '수학', 4);
    simple(c, '영어', '영어', 4);
    simple(c, '한국사', '사회', 3);
    simple(c, '통합사회', '사회', 4);
    simple(c, '통합과학', '과학', 4);
    simple(c, '과학탐구실험', '과학', 1, sci[0]);
    simple(c, '체육', '체육', 2);
    simple(c, '음악', '음악', 2, music);
    simple(c, '미술', '미술', 2, art, [2]);
    simple(c, '기술·가정', '기술가정', 2);
    simple(c, '자율활동', '담임', 1);
  }

  // 2·3학년: 공통 + 선택과목 묶음 (학급당 34시간)
  const bands: [string, string][][] = [
    [['물리학', '과학'], ['화학', '과학'], ['생명과학', '과학'], ['세계사', '사회'], ['경제', '사회'], ['정치와 법', '사회']],
    [['지구과학', '과학'], ['화학', '과학'], ['생명과학', '과학'], ['한국지리', '사회'], ['사회·문화', '사회'], ['윤리와 사상', '사회']],
    [['확률과 통계', '수학'], ['미적분', '수학'], ['기하', '수학'], ['영어 독해와 작문', '영어'], ['심화 국어', '국어'], ['정보', '정보']],
    [['일본어', '제2외국어'], ['중국어', '제2외국어'], ['한문', '제2외국어'], ['프로그래밍', '정보'], ['심리학', '교양'], ['교육학', '교양']],
  ];
  const common: [string, string, string, number][][] = [
    [['문학', '국어', '국어', 4], ['수학Ⅰ', '수학', '수학', 4], ['영어Ⅰ', '영어', '영어', 4]],
    [['독서', '국어', '국어', 4], ['수학Ⅱ', '수학', '수학', 4], ['영어Ⅱ', '영어', '영어', 4]],
  ];
  for (const g of [2, 3]) {
    const cls = classes[g - 1];
    for (const c of cls) {
      for (const [name, , dept, h] of common[g - 2]) simple(c, name, dept, h);
      simple(c, '체육', '체육', 2);
      simple(c, g === 2 ? '음악 감상과 비평' : '미술 창작', g === 2 ? '음악' : '미술', 2, g === 2 ? music : art, g === 3 ? [2] : undefined);
      simple(c, '진로', '진로', 1);
      simple(c, '자율활동', '담임', 1);
    }
    bands.forEach((band, bi) => {
      const used = new Set<string>();
      let sciIdx = 0;
      let selIdx = 0;
      const parts = band.map(([name, dept]) => {
        const t = teacher(dept, 3, used);
        used.add(t);
        const roomId = dept === '과학' ? sci[sciIdx++] : sel[selIdx++];
        return { subjectId: subject(name), teacherId: t, roomId };
      });
      lesson(cls, parts, [1, 1, 1], `${g}학년 선택${'ABCD'[bi]}`);
    });
    // 4개 묶음 × 3시간 = 12시간, 공통 12 + 체육 2 + 예술 2 + 진로 1 + 자율 1 = 18 → 30. 남은 4시간:
    for (const c of cls) simple(c, g === 2 ? '통합 논술' : '진로 탐구', '교양', 3);
  }

  // 동아리: 전교생이 같은 시간에 (금요일 7교시에 고정)
  const club = lesson(classes.flat(), [{ subjectId: subject('동아리'), teacherId: null, roomId: null }], [1], '동아리');
  db.placements[`${club.id}:0`] = { id: `${club.id}:0`, lessonId: club.id, idx: 0, day: 4, period: 7, pinned: true };

  // 과목에 필요한 교실 종류 (교과교실제)
  const KIND: Record<string, string> = { 과학탐구실험: '과학실', 음악: '음악실', '음악 감상과 비평': '음악실', 미술: '미술실', '미술 창작': '미술실' };
  for (const s of Object.values(db.subjects)) if (KIND[s.name]) s.roomKind = KIND[s.name];

  // 학생: 학급당 24명. 2·3학년은 선택과목 묶음마다 강좌 하나를 고른다.
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const bandLessons = Object.values(db.lessons).filter((l) => l.parts.length > 1);
  let sn = 0;
  for (const c of Object.values(db.classes))
    for (let num = 1; num <= 24; num++) {
      const id = nid('u');
      const choices: Record<string, number> = {};
      for (const b of bandLessons) if (b.classIds.includes(c.id)) choices[b.id] = Math.floor(rnd() * b.parts.length);
      db.students[id] = { id, classId: c.id, num, name: `${SURNAMES[(sn * 3) % SURNAMES.length]}${GIVEN[(sn * 11 + num) % GIVEN.length]}`, choices };
      sn++;
    }

  // 순회 교사 한 명: 월·화에는 수업 불가
  const visiting = pools.get('제2외국어')?.[0];
  if (visiting) {
    const s = db.settings.main;
    for (const d of [0, 1]) for (let p = 1; p <= s.periodsPerDay[d]; p++) db.teachers[visiting.id].unavailable.push(`${d}-${p}`);
  }
  return db;
}
