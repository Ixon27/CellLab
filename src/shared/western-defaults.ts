export type Reagent = 'D.W' | '1.5 M Tris' | '1.0 M Tris' | '10% SDS' | '30% Acry' | 'APS' | 'TEMED';
export const SEPARATING_RECIPES: Record<5 | 10, Record<5 | 8 | 10 | 12 | 15, Partial<Record<Reagent, number>>>> = {
  5: {
    5: { 'D.W': 2839, '1.5 M Tris': 1250, '10% SDS': 50, '30% Acry': 834, APS: 25, TEMED: 2.5 },
    8: { 'D.W': 2425, '1.5 M Tris': 1250, '10% SDS': 50, '30% Acry': 1250, APS: 25, TEMED: 2.5 },
    10: { 'D.W': 2009, '1.5 M Tris': 1250, '10% SDS': 50, '30% Acry': 1667, APS: 25, TEMED: 2.5 },
    12: { 'D.W': 1675, '1.5 M Tris': 1250, '10% SDS': 50, '30% Acry': 2000, APS: 25, TEMED: 2.5 },
    15: { 'D.W': 1175, '1.5 M Tris': 1250, '10% SDS': 50, '30% Acry': 2500, APS: 25, TEMED: 2.5 },
  },
  10: {
    5: { 'D.W': 5678, '1.5 M Tris': 2500, '10% SDS': 100, '30% Acry': 1667, APS: 50, TEMED: 5 },
    8: { 'D.W': 4850, '1.5 M Tris': 2500, '10% SDS': 100, '30% Acry': 2500, APS: 50, TEMED: 5 },
    10: { 'D.W': 4017, '1.5 M Tris': 2500, '10% SDS': 100, '30% Acry': 3333, APS: 50, TEMED: 5 },
    12: { 'D.W': 3350, '1.5 M Tris': 2500, '10% SDS': 100, '30% Acry': 4000, APS: 50, TEMED: 5 },
    15: { 'D.W': 2350, '1.5 M Tris': 2500, '10% SDS': 100, '30% Acry': 5000, APS: 50, TEMED: 5 },
  },
};
export const STACKING_RECIPES: Record<5 | 7.5 | 10, Partial<Record<Reagent, number>>> = {
  5: { 'D.W': 3050, '1.0 M Tris': 1250, '10% SDS': 50, '30% Acry': 650, APS: 25, TEMED: 5 },
  7.5: { 'D.W': 4575, '1.0 M Tris': 1875, '10% SDS': 75, '30% Acry': 975, APS: 37.5, TEMED: 7.5 },
  10: { 'D.W': 6100, '1.0 M Tris': 2500, '10% SDS': 100, '30% Acry': 1300, APS: 50, TEMED: 10 },
};
export const SEPARATING_PCT_NOTES = { 8: '원문 8% 열은 30% Acry 투입량 기준 계산상 7.5%' };
export const STACKING_NOTE = '원문 표기 4% (계산값과 차이 있음, 프로토콜 1-1 메모 참고)';
export const ACRYLAMIDE_RANGES = [
  { pct: 15, range: '10–43' },
  { pct: 12, range: '12–60' },
  { pct: 10, range: '20–80' },
  { pct: 7.5, range: '36–94' },
  { pct: 5, range: '57–212' },
];
export const DEFAULT_LOADING = { proteinUg: 20, finalUl: 25, sampleBufferX: 5 };
export const LOADING_PRESETS = [
  { id: 'v1-1', label: '프로토콜 v1.1 (20 µg / 25 µL / 5X)', ...DEFAULT_LOADING },
  { id: 'lab-notes', label: '실험실 노트 (20 µg / 15 µL / 5X)', proteinUg: 20, finalUl: 15, sampleBufferX: 5 },
];
export const DEFAULT_TEMED_MULTIPLIER = 2;
export const ECL_PER_MEMBRANE = { ecl1: 100, ecl2: 100, tbst: 100 };
export const WESTERN_STEPS: { id: string; phase: 1 | 2 | 3; title: string; timerMin?: number }[] = [
  { id: '1-1', phase: 1, title: '준비물·겔 농도 선택 및 조성표' },
  { id: '1-2', phase: 1, title: '유리판·Gasket 조립, 하단 정렬과 누수 확인' },
  { id: '1-3', phase: 1, title: 'Separating gel 만들기' },
  { id: '1-4', phase: 1, title: 'Isopropanol 올리기·겔 굳히기·제거' },
  { id: '1-5', phase: 1, title: 'Stacking gel 만들기·Comb 꽂기·굳히기' },
  { id: '2-1', phase: 2, title: '단백질 추출·Bradford 정량' },
  { id: '2-2', phase: 2, title: '시료 준비 (95 °C 5분 가열)', timerMin: 5 },
  { id: '2-3', phase: 2, title: '전기영동 장치 조립·Buffer 충전·로딩' },
  { id: '2-4', phase: 2, title: 'SDS-PAGE 80 V 약 90분', timerMin: 90 },
  { id: '2-5', phase: 2, title: 'Transfer 100 V 90분 (냉각 유지)', timerMin: 90 },
  { id: '2-6', phase: 2, title: 'Membrane 회수·Ponceau S 염색·TBST 3–4회×5분', timerMin: 5 },
  { id: '2-7', phase: 2, title: '최초 Blocking 1시간 → TBST 3회×5분', timerMin: 60 },
  { id: '2-8', phase: 2, title: '1차 항체 4 °C overnight' },
  { id: '3-1', phase: 3, title: '실온 1시간 → TBST 3회×10분', timerMin: 60 },
  { id: '3-2', phase: 3, title: '추가 Blocking 1시간 → TBST 3회×5분', timerMin: 60 },
  { id: '3-3', phase: 3, title: '2차 항체 실온 1시간 → TBST 3회×5분', timerMin: 60 },
  { id: '3-4', phase: 3, title: 'ECL 조제·처리' },
  { id: '3-5', phase: 3, title: 'ChemiDoc 촬영·원본 저장·TBST 1회×5분', timerMin: 5 },
  { id: '3-6', phase: 3, title: '필요 시 Stripping(5분)·재검출', timerMin: 5 },
];
export const WASH_SUMMARY = [
  ['Ponceau S 탈색', '3–4회', '5분'],
  ['최초 blocking 후', '3회', '5분'],
  ['1차 항체 반응 후', '3회', '10분'],
  ['추가 blocking 후', '3회', '5분'],
  ['2차 항체 반응 후', '3회', '5분'],
  ['촬영 후', '1회', '5분'],
  ['Stripping 후', '1회', '5분'],
];
export const WESTERN_RECORD_FIELDS = [
  '실험일 / 수행자',
  '시료명 / 처리 조건 / 시료 수',
  '겔 장수 / 겔 크기·두께 / separating gel 농도',
  'Running buffer fresh·재사용 구분',
  'Transfer buffer transfer tank 사용량 / 조립 트레이 사용량',
  'Transfer buffer 재사용 여부 / 냉각 방식',
  'Bradford 정량값 / 정량 희석배수',
  '시료별 단백질 원액 / PRO-PREP / 5X sample buffer 부피',
  '로딩 기준',
  '유리판 방향 / 하단 정렬 / 누수 확인',
  '환원제 / 시료 가열 조건',
  'Lane map / ladder 로딩 부피',
  '전기영동 시작 / 종료',
  '전이 시작 / 종료',
  '단백질 전이 면 표시 / 막 절단 위치 / Ponceau S 사진',
  '5% BSA 용매',
  '1차 항체 / 희석비 / 사용량 / 반응 시작·종료',
  '실온 유지 / 추가 blocking 시작·종료',
  '2차 항체 / 희석비 / 사용량 / 반응 시작·종료',
  'ECL 혼합 조건',
  'ECL 반응시간 / 촬영 노출 조건 / 원본 파일',
  'Stripping 실제 부피 / 시작·종료',
  '다음 표적 / 재검출 횟수',
].map((label, i) => ({ key: `r${String(i + 1).padStart(2, '0')}`, label }));
