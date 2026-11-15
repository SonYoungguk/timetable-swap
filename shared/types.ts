// 모든 기능(편성·공개·교체·고교학점제·교과교실제)이 함께 쓰는 데이터 구조.
// day 는 0부터(월=0), period 는 1부터(1교시=1).

export interface Settings {
  id: 'main';
  schoolName: string;
  days: string[];
  /** 요일별 교시 수 */
  periodsPerDay: number[];
  /** 점심 직전 교시. 연강이 점심을 걸치지 않게 하고, 연속 수업 계산을 끊는다. */
  lunchAfter: number;
  /** 교사 하루 최대 수업 시수(권장) */
  maxTeacherPerDay: number;
  /** 교사 최대 연속 수업 시수(권장) */
  maxTeacherConsecutive: number;
}

export interface Teacher {
  id: string;
  name: string;
  /** 수업 불가 시간. "요일-교시" 형식 (예: "0-1" = 월 1교시) */
  unavailable: string[];
  /** 교과교실제: 이 교사의 전용 교실 */
  roomId?: string | null;
}

export interface Subject {
  id: string;
  name: string;
  short: string;
  color: string;
  /** 교과교실제: 이 과목 수업에 필요한 교실 종류 (비우면 아무 교실/학급 교실) */
  roomKind?: string;
}

export interface Room {
  id: string;
  name: string;
  /** 교실 종류 (과학실, 음악실, 선택교실 …) */
  kind: string;
  /** 수용 인원 (0 또는 없음 = 제한 없음) */
  capacity?: number;
}

export interface SchoolClass {
  id: string;
  grade: number;
  num: number;
  name: string;
}

/** 한 수업 안에서 동시에 열리는 강좌 하나 (과목·교사·교실). */
export interface LessonPart {
  subjectId: string;
  teacherId: string | null;
  /** null 이면 학급 교실에서 수업 (교실 충돌 검사 안 함) */
  roomId: string | null;
}

/**
 * 시간표에 놓이는 수업 단위.
 * - 일반 수업: classIds 1개, parts 1개
 * - 합반: classIds 여러 개, parts 1개
 * - 선택과목 묶음(고교학점제): classIds 여러 개, parts 여러 개 → 같은 시간에 동시에 열림
 */
export interface Lesson {
  id: string;
  /** 묶음 이름 (예: "2학년 선택A"). 일반 수업은 비워 둔다. */
  label: string;
  classIds: string[];
  parts: LessonPart[];
  /** 주당 수업을 나눈 덩어리. [1,1,1,1] = 1시간씩 4번, [2,1] = 연강 1번 + 1시간 1번 */
  blocks: number[];
}

/** 수업 덩어리 하나가 놓인 자리. id 는 `${lessonId}:${idx}` */
export interface Placement {
  id: string;
  lessonId: string;
  idx: number;
  day: number;
  period: number;
  /** 고정: 자동 편성이 옮기지 않는다 */
  pinned: boolean;
}

/** 고교학점제: 학생과 선택과목 묶음별 수강 강좌 */
export interface Student {
  id: string;
  classId: string;
  num: number;
  name: string;
  /** 묶음 수업 id → 수강하는 강좌 번호(parts 의 순서) */
  choices: Record<string, number>;
}

/**
 * 특정 날짜의 수업 한 번에 대한 변경 (교체·이동·대강·결강).
 * id 는 `${unitId}@${date}` — 수업 한 번에 변경은 하나만 있다.
 */
export interface Change {
  id: string;
  unitId: string;
  /** 원래 수업 날짜 (YYYY-MM-DD) */
  date: string;
  /** 옮겨 간 날짜·교시. 옮기지 않았으면 원래 값과 같다. */
  toDate: string;
  toPeriod: number;
  cancelled: boolean;
  /** 강좌 번호 → 대신 들어가는 교사 */
  teachers: Record<string, string>;
  note: string;
  /** 함께 이루어진 변경(맞교환 등)을 묶는 id */
  groupId: string;
  createdAt: number;
}

/** 공개된 확정 시간표. 편성 중인 안과 따로 보관한다. */
export interface Published {
  id: 'main';
  publishedAt: number;
  snapshot: Pick<Db, SnapshotName>;
}

/** 로그인하지 않은 사람에게 보여 줄 수 있게 다듬은 게시본 (학생 이름·교사 수업 불가 시간 제외) */
export interface PublicView {
  id: 'main';
  publishedAt: number;
  snapshot: Pick<Db, SnapshotName>;
}

export function guestSnapshot(snapshot: Pick<Db, SnapshotName>): Pick<Db, SnapshotName> {
  const students: Db['students'] = {};
  for (const s of Object.values(snapshot.students ?? {})) students[s.id] = { ...s, name: '' };
  const teachers: Db['teachers'] = {};
  for (const t of Object.values(snapshot.teachers)) teachers[t.id] = { ...t, unavailable: [] };
  return { ...snapshot, students, teachers };
}

export const SNAPSHOT: SnapshotName[] = ['settings', 'teachers', 'subjects', 'rooms', 'classes', 'lessons', 'placements', 'students'];
export type SnapshotName = 'settings' | 'teachers' | 'subjects' | 'rooms' | 'classes' | 'lessons' | 'placements' | 'students';

export interface Collections {
  settings: Settings;
  teachers: Teacher;
  subjects: Subject;
  rooms: Room;
  classes: SchoolClass;
  lessons: Lesson;
  placements: Placement;
  students: Student;
  changes: Change;
  published: Published;
  public: PublicView;
}

export type CollectionName = keyof Collections;

export const COLLECTIONS: CollectionName[] = [
  'settings',
  'teachers',
  'subjects',
  'rooms',
  'classes',
  'lessons',
  'placements',
  'students',
  'changes',
  'published',
  'public',
];

export type Db = { [K in CollectionName]: Record<string, Collections[K]> };

export type Op =
  | { op: 'put'; collection: CollectionName; doc: { id: string } & Record<string, unknown> }
  | { op: 'del'; collection: CollectionName; id: string };

export function emptyDb(): Db {
  return { settings: {}, teachers: {}, subjects: {}, rooms: {}, classes: {}, lessons: {}, placements: {}, students: {}, changes: {}, published: {}, public: {} };
}

export function defaultSettings(): Settings {
  return {
    id: 'main',
    schoolName: '우리학교',
    days: ['월', '화', '수', '목', '금'],
    periodsPerDay: [7, 7, 6, 7, 7],
    lunchAfter: 4,
    maxTeacherPerDay: 5,
    maxTeacherConsecutive: 3,
  };
}

export function getSettings(db: Db): Settings {
  return db.settings.main ?? defaultSettings();
}

export function applyOps(db: Db, ops: Op[]): Db {
  const next: Db = { ...db };
  const copied = new Set<CollectionName>();
  for (const op of ops) {
    if (!copied.has(op.collection)) {
      (next as Record<string, unknown>)[op.collection] = { ...db[op.collection] };
      copied.add(op.collection);
    }
    const col = next[op.collection] as Record<string, unknown>;
    if (op.op === 'put') col[op.doc.id] = op.doc;
    else delete col[op.id];
  }
  return next;
}

/** 조회 화면이 쓰는 자료: 게시된 시간표 + 날짜별 변경. 게시본이 없으면 null. */
export function publishedView(db: Db): Db | null {
  const pub = db.published.main;
  if (!pub) return null;
  return { ...emptyDb(), ...pub.snapshot, changes: db.changes, published: db.published };
}
