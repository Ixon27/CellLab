import { validateMediumProductSnapshot, type MediumProductSnapshot } from './lab-products';

export type PlanStage = 'stock' | 'thaw' | 'feed' | 'passage' | 'freeze';
export type PlanStatus = 'confirmed' | 'supported' | 'decision' | 'conditional' | 'unresolved';
export interface PlanSource {
  kind: 'bank_reply' | 'bank_general' | 'paper' | 'lab' | 'manufacturer';
  label: string;
  quote: string;
  url: string | null;
}
export interface PlanCondition {
  id: string;
  label: string;
  value: string;
  status: PlanStatus;
  sources: PlanSource[];
  note: string;
  stages: PlanStage[];
}
export interface CultureExecutionPlan {
  version: 1;
  summary: string;
  conditions: PlanCondition[];
  steps: Record<PlanStage, { instructions: string; recordLabels: string[] }>;
  mediumRecipe: {
    baseLabel: string;
    /** Optional link to a lab inventory product; the snapshot is a frozen copy, never refreshed implicitly. */
    baseProductId?: string;
    baseProduct?: MediumProductSnapshot;
    components: {
      id: string;
      label: string;
      percent: number;
      stockConfirmed: boolean;
      stockIngredients: { label: string; value: number; unit: string }[];
      productId?: string;
      product?: MediumProductSnapshot;
    }[];
  } | null;
}
/** Heading line of the condition snapshot appended to an operation note. */
export const CONDITION_SNAPSHOT_HEADING = '[사용 조건 스냅샷 · 실행 완료/외부 검증을 의미하지 않음]';
/**
 * A note split into what the user wrote and the condition snapshot the app appended to it. Matches on the heading's
 * start, so snapshots with an earlier heading wording split too.
 */
export function splitConditionSnapshot(note: string): { text: string; snapshot: string } {
  const at = note.indexOf('\n[사용 조건 스냅샷');
  if (at < 0) return { text: note.trim(), snapshot: '' };
  return { text: note.slice(0, at).trim(), snapshot: note.slice(at).trim() };
}
export const PLAN_STAGE_LABELS: Record<PlanStage, string> = {
  stock: 'Stock 입고',
  thaw: '해동',
  feed: '관찰·배지 교체',
  passage: '계대',
  freeze: '동결',
};
export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  confirmed: '확인됨',
  supported: '문헌·일반 근거',
  decision: '실험실 결정',
  conditional: '조건부',
  unresolved: '미확인',
};
const fail = (): never => {
  throw new Error('실행 계획 형식이 올바르지 않습니다');
};
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
  return raw as Record<string, unknown>;
}
function text(raw: unknown, max: number, required = false): string {
  if (typeof raw !== 'string' || raw.length > max || (required && !raw.trim())) return fail();
  return raw;
}
function list(raw: unknown, max: number): unknown[] {
  if (!Array.isArray(raw) || raw.length > max) return fail();
  return raw;
}
function number(raw: unknown, max: number, positive = false): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || (positive ? raw <= 0 : raw < 0) || raw > max) return fail();
  return raw;
}
/** Optional inventory-product link: both id and frozen snapshot, matching, or neither. */
function productLink(rawId: unknown, rawProduct: unknown): { productId: string; product: MediumProductSnapshot } | null {
  if ((rawId === undefined || rawId === null) && (rawProduct === undefined || rawProduct === null)) return null;
  const productId = text(rawId, 120, true);
  let product: MediumProductSnapshot;
  try {
    product = validateMediumProductSnapshot(rawProduct);
  } catch {
    return fail();
  }
  if (product.id !== productId) return fail();
  return { productId, product };
}
export function validateExecutionPlan(raw: unknown): CultureExecutionPlan | null {
  if (raw == null) return null;
  const p = object(raw);
  if (p.version !== 1) return fail();
  const ids = new Set<string>();
  const conditions = list(p.conditions, 100).map((rawCondition): PlanCondition => {
    const c = object(rawCondition);
    const id = text(c.id, 120, true);
    if (ids.has(id) || typeof c.status !== 'string' || !Object.hasOwn(PLAN_STATUS_LABELS, c.status)) return fail();
    ids.add(id);
    const stages = list(c.stages, 5).map((stage) => {
      if (typeof stage !== 'string' || !Object.hasOwn(PLAN_STAGE_LABELS, stage)) return fail();
      return stage as PlanStage;
    });
    if (new Set(stages).size !== stages.length) return fail();
    const sources = list(c.sources, 30).map((rawSource): PlanSource => {
      const s = object(rawSource);
      if (typeof s.kind !== 'string' || !['bank_reply', 'bank_general', 'paper', 'lab', 'manufacturer'].includes(s.kind)) return fail();
      let url: string | null = null;
      if (s.url !== null) {
        url = text(s.url, 2000, true);
        try {
          if (!['http:', 'https:'].includes(new URL(url).protocol)) return fail();
        } catch {
          return fail();
        }
      }
      return { kind: s.kind as PlanSource['kind'], label: text(s.label, 300, true), quote: text(s.quote, 10000), url };
    });
    return {
      id,
      label: text(c.label, 300, true),
      value: text(c.value, 3000),
      status: c.status as PlanStatus,
      sources,
      note: text(c.note, 5000),
      stages,
    };
  });
  const rawSteps = object(p.steps);
  const steps = {} as CultureExecutionPlan['steps'];
  for (const stage of Object.keys(PLAN_STAGE_LABELS) as PlanStage[]) {
    const step = object(rawSteps[stage]);
    steps[stage] = {
      instructions: text(step.instructions, 20000),
      recordLabels: list(step.recordLabels, 50).map((label) => text(label, 200, true)),
    };
  }
  let mediumRecipe: CultureExecutionPlan['mediumRecipe'] = null;
  if (p.mediumRecipe !== null) {
    const r = object(p.mediumRecipe);
    const componentIds = new Set<string>();
    const components = list(r.components, 50).map((rawComponent) => {
      const c = object(rawComponent);
      const id = text(c.id, 120, true);
      if (componentIds.has(id) || typeof c.stockConfirmed !== 'boolean') return fail();
      componentIds.add(id);
      const stockIngredients = list(c.stockIngredients, 30).map((rawIngredient) => {
        const i = object(rawIngredient);
        return { label: text(i.label, 300, true), value: number(i.value, Number.MAX_VALUE, true), unit: text(i.unit, 100, true) };
      });
      if (c.stockConfirmed && stockIngredients.length === 0) return fail();
      const link = productLink(c.productId, c.product);
      if (link) {
        // A linked component carries the product's frozen stock; it can claim "confirmed" only if the product was.
        const frozen = link.product.ingredients;
        if (stockIngredients.length !== frozen.length || stockIngredients.some((x, i) => x.label !== frozen[i].label || x.value !== frozen[i].value || x.unit !== frozen[i].unit))
          return fail();
        if (c.stockConfirmed && !link.product.ingredientsConfirmed) return fail();
      }
      return {
        id,
        label: text(c.label, 300, true),
        percent: number(c.percent, 100),
        stockConfirmed: c.stockConfirmed,
        stockIngredients,
        ...(link ? { productId: link.productId, product: link.product } : {}),
      };
    });
    if (components.reduce((sum, c) => sum + c.percent, 0) >= 100) return fail();
    const baseLink = productLink(r.baseProductId, r.baseProduct);
    mediumRecipe = {
      baseLabel: text(r.baseLabel, 300, true),
      ...(baseLink ? { baseProductId: baseLink.productId, baseProduct: baseLink.product } : {}),
      components,
    };
  }
  return { version: 1, summary: text(p.summary, 10000), conditions, steps, mediumRecipe };
}
export function mediumRecipe(plan: CultureExecutionPlan, totalMl: number) {
  number(totalMl, 100000, true);
  const r = plan.mediumRecipe;
  if (!r) return null;
  const components = r.components.map((c) => ({
    id: c.id,
    label: c.label,
    percent: c.percent,
    ml: (totalMl * c.percent) / 100,
    finalIngredients:
      c.stockConfirmed && c.stockIngredients.length && (!c.product || c.product.ingredientsConfirmed)
        ? c.stockIngredients.map((i) => ({ label: i.label, value: i.value * (c.percent / 100), unit: i.unit }))
        : null,
  }));
  return { totalMl, baseMl: totalMl - components.reduce((sum, c) => sum + c.ml, 0), components };
}
