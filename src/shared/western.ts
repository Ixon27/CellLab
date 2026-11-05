import {
  DEFAULT_LOADING,
  DEFAULT_TEMED_MULTIPLIER,
  ECL_PER_MEMBRANE,
  SEPARATING_RECIPES,
  STACKING_RECIPES,
  WESTERN_RECORD_FIELDS,
  WESTERN_STEPS,
} from './western-defaults';

export interface WesternData {
  gel: {
    separatingPct: 5 | 8 | 10 | 12 | 15;
    separatingScale: 5 | 10;
    stackingScale: 5 | 7.5 | 10;
    batches: number;
    temedMultiplier: number;
  };
  loading: { proteinUg: number; finalUl: number; sampleBufferX: number };
  samples: { id: string; name: string; concUgPerUl: number | null; source: { bradfordId: string; sampleIndex: number } | null }[];
  wells: number;
  lanes: string[];
  membranes: number;
  antibodies: {
    id: string;
    kind: 'primary' | 'secondary';
    target: string;
    product: string;
    dilutionN: number;
    diluent: string;
    totalUl: number;
    start: string | null;
    end: string | null;
  }[];
  steps: Record<string, { done: boolean; doneAt: string | null; note: string }>;
  record: Record<string, string>;
  notes: string;
}
export interface WesternRunMeta {
  id: string;
  title: string;
  performed_at: string;
  status: 'planned' | 'in_progress' | 'done';
  protocol_id: string | null;
  created_at: string;
  updated_at: string;
}
export interface WesternRunView {
  run: WesternRunMeta;
  data: WesternData;
}
export interface GelRow {
  reagent: string;
  originalUl: number;
  fieldUl: number;
}
export function gelRecipe(
  o:
    | { kind: 'separating'; pct: 5 | 8 | 10 | 12 | 15; scaleMl: 5 | 10; batches: number; temedMultiplier: number }
    | { kind: 'stacking'; scaleMl: 5 | 7.5 | 10; batches: number; temedMultiplier: number },
) {
  if (!Number.isInteger(o.batches) || o.batches < 1 || o.batches > 10 || !Number.isFinite(o.temedMultiplier) || o.temedMultiplier <= 0)
    throw new Error('겔 배합 조건이 올바르지 않습니다');
  const recipe = o.kind === 'separating' ? SEPARATING_RECIPES[o.scaleMl]?.[o.pct] : STACKING_RECIPES[o.scaleMl];
  if (!recipe) throw new Error('겔 조성표를 찾을 수 없습니다');
  const rows: GelRow[] = Object.entries(recipe).map(([reagent, n]) => ({
    reagent,
    originalUl: n * o.batches,
    fieldUl: n * o.batches * (reagent === 'TEMED' ? o.temedMultiplier : 1),
  }));
  return { rows, totalOriginalUl: rows.reduce((s, r) => s + r.originalUl, 0), totalFieldUl: rows.reduce((s, r) => s + r.fieldUl, 0) };
}
export function loadingPlan(concUgPerUl: number | null, l: WesternData['loading']) {
  if (concUgPerUl === null || !Number.isFinite(concUgPerUl) || concUgPerUl <= 0) return null;
  const bufferUl = l.finalUl / l.sampleBufferX,
    room = l.finalUl - bufferUl,
    sampleUl = l.proteinUg / concUgPerUl;
  return { sampleUl, diluentUl: room - sampleUl, bufferUl, finalUl: l.finalUl, ok: sampleUl <= room, minConc: l.proteinUg / room };
}
export function antibodyMix(dilutionN: number, totalUl: number) {
  return { antibodyUl: totalUl / dilutionN, diluentUl: totalUl - totalUl / dilutionN };
}
export function eclMix(membranes: number) {
  const ecl1 = ECL_PER_MEMBRANE.ecl1 * membranes,
    ecl2 = ECL_PER_MEMBRANE.ecl2 * membranes,
    tbst = ECL_PER_MEMBRANE.tbst * membranes;
  return { ecl1, ecl2, tbst, total: ecl1 + ecl2 + tbst };
}
export function defaultLanes(sampleNames: string[], wells = 10): string[] {
  const lanes = ['(빈 칸)', 'Ladder', ...sampleNames, 'Ladder', '(빈 칸)'];
  while (lanes.length < wells) lanes.push('(빈 칸)');
  return lanes;
}
export function createWesternData(): WesternData {
  return {
    gel: { separatingPct: 10, separatingScale: 10, stackingScale: 5, batches: 1, temedMultiplier: DEFAULT_TEMED_MULTIPLIER },
    loading: { ...DEFAULT_LOADING },
    samples: [],
    wells: 10,
    lanes: defaultLanes([]),
    membranes: 1,
    antibodies: [],
    steps: Object.fromEntries(WESTERN_STEPS.map((s) => [s.id, { done: false, doneAt: null, note: '' }])),
    record: {},
    notes: '',
  };
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('실험 데이터 형식이 올바르지 않습니다');
  return v as Record<string, unknown>;
}
function text(v: unknown, max = 5000): string {
  if (typeof v !== 'string' || v.length > max) throw new Error('문자열 입력이 올바르지 않습니다');
  return v;
}
function num(v: unknown, min: number, max: number, integer = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v)))
    throw new Error('수치 입력 범위를 확인하세요');
  return v;
}
function date(v: unknown): string | null {
  if (v === null) return null;
  const s = text(v, 80);
  if (!Number.isFinite(Date.parse(s))) throw new Error('시각 입력이 올바르지 않습니다');
  return s;
}
export function validateWesternData(raw: unknown): WesternData {
  const r = object(raw),
    g = object(r.gel),
    l = object(r.loading);
  if (
    ![5, 8, 10, 12, 15].includes(Number(g.separatingPct)) ||
    ![5, 10].includes(Number(g.separatingScale)) ||
    ![5, 7.5, 10].includes(Number(g.stackingScale))
  )
    throw new Error('겔 조건이 올바르지 않습니다');
  if (
    !Array.isArray(r.samples) ||
    r.samples.length > 30 ||
    !Array.isArray(r.antibodies) ||
    r.antibodies.length > 20 ||
    ![10, 12, 15].includes(Number(r.wells))
  )
    throw new Error('시료·항체·웰 개수를 확인하세요');
  if (!Array.isArray(r.lanes) || r.lanes.length > 34) throw new Error('레인 정보가 올바르지 않습니다');
  const steps = object(r.steps),
    record = object(r.record);
  const result: WesternData = {
    gel: {
      separatingPct: num(g.separatingPct, 5, 15) as WesternData['gel']['separatingPct'],
      separatingScale: num(g.separatingScale, 5, 10) as 5 | 10,
      stackingScale: num(g.stackingScale, 5, 10) as 5 | 7.5 | 10,
      batches: num(g.batches, 1, 10, true),
      temedMultiplier: num(g.temedMultiplier, 0.01, 100),
    },
    loading: {
      proteinUg: num(l.proteinUg, 0.001, 100000),
      finalUl: num(l.finalUl, 0.001, 50000),
      sampleBufferX: num(l.sampleBufferX, 1.001, 100),
    },
    samples: r.samples.map((v) => {
      const s = object(v),
        source = s.source === null ? null : object(s.source);
      return {
        id: text(s.id, 120),
        name: text(s.name, 200),
        concUgPerUl: s.concUgPerUl === null ? null : num(s.concUgPerUl, 0, 1e9),
        source: source ? { bradfordId: text(source.bradfordId, 120), sampleIndex: num(source.sampleIndex, 0, 95, true) } : null,
      };
    }),
    wells: num(r.wells, 10, 15, true),
    lanes: r.lanes.map((v) => text(v, 200)),
    membranes: num(r.membranes, 1, 100, true),
    antibodies: r.antibodies.map((v) => {
      const a = object(v);
      if (a.kind !== 'primary' && a.kind !== 'secondary') throw new Error('항체 종류가 올바르지 않습니다');
      return {
        id: text(a.id, 120),
        kind: a.kind,
        target: text(a.target, 200),
        product: text(a.product, 200),
        dilutionN: num(a.dilutionN, 1, 100000),
        diluent: text(a.diluent, 200),
        totalUl: num(a.totalUl, 1, 50000),
        start: date(a.start),
        end: date(a.end),
      };
    }),
    steps: Object.fromEntries(
      WESTERN_STEPS.map((s) => {
        const v = steps[s.id] === undefined ? { done: false, doneAt: null, note: '' } : object(steps[s.id]);
        if (typeof v.done !== 'boolean') throw new Error('단계 완료 값이 올바르지 않습니다');
        return [s.id, { done: v.done, doneAt: date(v.doneAt), note: text(v.note) }];
      }),
    ),
    record: Object.fromEntries(WESTERN_RECORD_FIELDS.filter((f) => record[f.key] !== undefined).map((f) => [f.key, text(record[f.key])])),
    notes: text(r.notes, 50000),
  };
  return result;
}
export function westernAutoRecord(d: WesternData): Record<string, string> {
  const antibody = (kind: 'primary' | 'secondary') =>
    d.antibodies
      .filter((a) => a.kind === kind)
      .map((a) => `${a.target} / ${a.product} / 1:${a.dilutionN} / ${a.totalUl} µL / ${a.start ?? '미정'}–${a.end ?? '미정'}`)
      .join('\n');
  const e = eclMix(d.membranes);
  return {
    r03: `separating gel ${d.gel.separatingPct}%`,
    r07: d.samples.map((s) => `${s.name}: ${s.concUgPerUl ?? '미정'} µg/µL`).join('\n'),
    r08: d.samples
      .map((s) => {
        const p = loadingPlan(s.concUgPerUl, d.loading);
        return `${s.name}: ${p ? `${p.sampleUl.toFixed(1)} / ${p.diluentUl.toFixed(1)} / ${p.bufferUl.toFixed(1)} µL` : '농도 미정'}`;
      })
      .join('\n'),
    r09: `${d.loading.proteinUg} µg / ${d.loading.finalUl} µL / ${d.loading.sampleBufferX}X sample buffer ${(d.loading.finalUl / d.loading.sampleBufferX).toFixed(1)} µL → 최종 1X`,
    r12: d.lanes.map((s, i) => `${i + 1}: ${s}`).join(', '),
    r17: antibody('primary'),
    r19: antibody('secondary'),
    r20: `용액 1 ${e.ecl1} µL + 용액 2 ${e.ecl2} µL + TBST ${e.tbst} µL / 총 ${e.total} µL`,
  };
}
export function westernMarkdown({ run, data: d }: WesternRunView): string {
  const cell = (v: unknown) =>
    String(v ?? '미정')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, '<br>');
  const table = (headers: string[], rows: unknown[][]) =>
    `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')}`;
  const sep = gelRecipe({
    kind: 'separating',
    pct: d.gel.separatingPct,
    scaleMl: d.gel.separatingScale,
    batches: d.gel.batches,
    temedMultiplier: d.gel.temedMultiplier,
  });
  const stack = gelRecipe({
    kind: 'stacking',
    scaleMl: d.gel.stackingScale,
    batches: d.gel.batches,
    temedMultiplier: d.gel.temedMultiplier,
  });
  const auto = westernAutoRecord(d);
  return [
    `# ${run.title}`,
    `실험일: ${run.performed_at}\n상태: ${{ planned: '계획', in_progress: '진행 중', done: '완료' }[run.status]}`,
    ...[sep, stack].map(
      (g, i) =>
        `## ${i ? 'Stacking' : 'Separating'} gel\n${table(
          ['시약', '원문 µL', '현장 µL'],
          g.rows.map((r) => [r.reagent, r.originalUl, r.fieldUl]),
        )}`,
    ),
    `## 로딩표\n${table(
      ['시료', '원액 µg/µL', '단백질 µL', 'PRO-PREP µL', 'Buffer µL', '합계 µL'],
      d.samples.map((s) => {
        const p = loadingPlan(s.concUgPerUl, d.loading);
        return [s.name, s.concUgPerUl, p?.sampleUl.toFixed(1), p?.diluentUl.toFixed(1), p?.bufferUl.toFixed(1), p?.finalUl];
      }),
    )}`,
    `## Lane map\n${d.lanes.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    `## 항체\n${table(
      ['종류', '표적', '제품', '희석비', '희석액', '총 µL', '시작', '종료'],
      d.antibodies.map((a) => [
        a.kind === 'primary' ? '1차' : '2차',
        a.target,
        a.product,
        `1:${a.dilutionN}`,
        a.diluent,
        a.totalUl,
        a.start,
        a.end,
      ]),
    )}`,
    `## ECL\n${auto.r20}`,
    `## 체크리스트\n${WESTERN_STEPS.map((s) => {
      const v = d.steps[s.id];
      return `- [${v?.done ? 'x' : ' '}] ${s.id} ${s.title} (${v?.doneAt ?? '미완료'}) ${v?.note ?? ''}`;
    }).join('\n')}`,
    `## 실험 기록란\n${WESTERN_RECORD_FIELDS.map((f) => `### ${f.key} ${f.label}\n${d.record[f.key] || auto[f.key] || ''}`).join('\n\n')}`,
    `## 메모\n${d.notes}`,
  ].join('\n\n');
}
