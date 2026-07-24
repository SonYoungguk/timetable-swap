# 교과교실제 실시간 시간표 교환 시스템 (timetable-swap)

교과교실제 운영 학교의 선생님들이 웹에서 시간표를 확인하고, 3중 중복 검증(교사·학반·교실)을 통과한 수업만 1:1로 안전하게 교환하는 시스템.

## 기술 스택

- **Frontend:** Next.js (App Router) + Tailwind CSS + Lucide React
- **Backend/DB:** Supabase (PostgreSQL + Realtime + RPC)
- 최종 교환은 PostgreSQL 함수 `execute_swap`이 행 잠금 상태에서 재검증 후 원자적으로 수행 → 동시 교환 경합에도 안전

## 실행

```bash
npm install
npm run dev
```

- `.env.local`에 Supabase 키가 **없으면 데모 모드**로 동작한다: 내장 샘플 시간표로 UI 전체(후보 추출·교환·교사 전환)를 체험할 수 있고, 교환은 브라우저 메모리에서만 반영된다.
- 실제 운영 모드: Supabase 프로젝트 생성 → SQL Editor에서 `supabase/schema.sql`, `supabase/seed.sql` 실행 → `.env.local` 작성:
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
  ```

## 파일 구성

| 파일 | 역할 |
|---|---|
| `supabase/schema.sql` | 테이블·뷰·RLS·Realtime 설정 + `execute_swap` RPC (서버측 3중 검증 & 원자적 교환) |
| `supabase/seed.sql` | 개발용 샘플 데이터 |
| `src/lib/swap-validator.ts` | `getSwappableSlots(slotA, all)` — 클라이언트 3중 중복 검증, 불가 사유 포함 |
| `src/lib/types.ts` | 공용 타입/상수 (`Schedule`, 요일·교시) |
| `src/lib/data-provider.ts` | Supabase 모드 / 데모 모드 전환 (조회·교환·실시간 구독 추상화) |
| `src/components/TimetableGrid.tsx` | 시간표 격자 UI — 하이라이트/Dimmed/Tooltip/확인 모달 |
| `src/hooks/useRealtimeSchedules.ts` | 실시간 구독 → 전 사용자 화면 즉시 갱신 |
| `src/app/page.tsx` | 시간표 조회·교환 메인 페이지 |
| `src/app/admin/page.tsx` | 관리자 페이지 — CSV 업로드로 기초 데이터 일괄 등록 |

## 3중 중복 검증 (6개 항목)

수업 A(T1)와 수업 B(T2)를 교환할 때, **교환이 완료된 상태**를 가정하고 검증한다
(따라서 점유 검사에서 A·B 자신은 제외 — 교환하면 원래 시간을 비우므로):

| # | 조건 | 검증 코드 |
|---|---|---|
| 1 | A교사가 T2에 수업 없음 | `TEACHER_A_BUSY_AT_B` |
| 2 | B교사가 T1에 수업 없음 | `TEACHER_B_BUSY_AT_A` |
| 3 | A학반이 T2에 수업 없음 | `CLASS_A_BUSY_AT_B` |
| 4 | B학반이 T1에 수업 없음 | `CLASS_B_BUSY_AT_A` |
| 5 | A 전용 교실이 T2에 빔 | `ROOM_A_OCCUPIED_AT_B` |
| 6 | B 전용 교실이 T1에 빔 | `ROOM_B_OCCUPIED_AT_A` |

같은 코드가 클라이언트(`getSwappableSlots`)와 서버(`execute_swap`) 양쪽에서 사용된다.
클라이언트 검증은 UI 후보 추출용, 서버 검증이 최종 안전장치다. 추가로 schedules 테이블의
`unique (teacher|class|room, day, period)` 제약이 DB 레벨 3중 방어선 역할을 한다.

## 다음 단계 (미구현)

- Supabase Auth 연동 — 현재는 데모용 교사 선택 드롭다운으로 로그인을 대체
- 교환 이력(swap_logs) 조회 화면 및 되돌리기
