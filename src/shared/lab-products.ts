import { VESSEL_AREA_CM2 } from './catalog';

export type SurfaceTreatment = 'treated' | 'untreated' | 'unknown';
export type VesselSpecStatus = 'reference' | 'product_confirmed';

export interface VesselProduct {
  id: string;
  label: string;
  format: string;
  manufacturer: string;
  catalogNo: string;
  surfaceTreatment: SurfaceTreatment;
  wellsPerUnit: number;
  areaCm2PerWell: number | null;
  mediumMinMlPerWell: number | null;
  mediumMaxMlPerWell: number | null;
  specStatus: VesselSpecStatus;
  sourceLabel: string;
  url: string | null;
}
export type VesselProductInput = Omit<VesselProduct, 'id'>;

/** A culture's use of one vessel product (a whole flask/dish, or some wells of a plate). */
export interface CultureVesselUse {
  vesselProductId: string;
  usedWells: number;
  mediumMl: number | null;
}
/** The use as stored on a culture: the product spec is frozen at assignment time. */
export interface CultureVesselUseSnapshot extends CultureVesselUse {
  product: VesselProduct;
}

export const SURFACE_LABELS: Record<SurfaceTreatment, string> = {
  treated: '표면 처리됨 (TC-treated)',
  untreated: '표면 미처리',
  unknown: '표면 처리 미확인',
};
export const SPEC_STATUS_LABELS: Record<VesselSpecStatus, string> = {
  reference: '참고값 (미확인)',
  product_confirmed: '제품 사양 확인',
};

export const REFERENCE_ID_PREFIX = 'ref:';
export const isReferenceVesselId = (id: string): boolean => id.startsWith(REFERENCE_ID_PREFIX);

/**
 * Built-in vessel formats from the app's reference area table (Corning-based; differs by manufacturer).
 * Area is a REFERENCE value, never product-confirmed, and no medium volume is ever included.
 */
export const REFERENCE_VESSEL_PRODUCTS: readonly VesselProduct[] = Object.entries(VESSEL_AREA_CM2).map(([format, area]) => {
  const wells = /^(\d+)-well$/.exec(format);
  return {
    id: `${REFERENCE_ID_PREFIX}${format}`,
    label: `${format} · 참고 사양`,
    format,
    manufacturer: '',
    catalogNo: '',
    surfaceTreatment: 'unknown',
    wellsPerUnit: wells ? Number(wells[1]) : 1,
    areaCm2PerWell: area,
    mediumMinMlPerWell: null,
    mediumMaxMlPerWell: null,
    specStatus: 'reference',
    sourceLabel: '앱 내장 참고 면적 (Corning 기준, 제조사·제품별 상이, 미확인)',
    url: null,
  } satisfies VesselProduct;
});

export function referenceVesselProduct(id: string): VesselProduct | null {
  return REFERENCE_VESSEL_PRODUCTS.find((p) => p.id === id) ?? null;
}

const fail = (message: string): never => {
  throw new Error(message);
};
function str(raw: unknown, field: string, max: number, required = false): string {
  if (raw === undefined || raw === null) raw = '';
  if (typeof raw !== 'string') return fail(`${field} 값이 올바르지 않습니다`);
  const v = raw.trim();
  if (required && !v) return fail(`${field}을(를) 입력하세요`);
  if (v.length > max) return fail(`${field}은(는) ${max}자 이하여야 합니다`);
  return v;
}
function optPositive(raw: unknown, field: string, max: number): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > max) return fail(`${field}은(는) 0보다 크고 ${max} 이하인 숫자여야 합니다`);
  return raw;
}
function optUrl(raw: unknown): string | null {
  const v = str(raw, 'URL', 2000);
  if (!v) return null;
  try {
    if (!['http:', 'https:'].includes(new URL(v).protocol)) return fail('URL은 http(s) 주소여야 합니다');
  } catch {
    return fail('URL은 http(s) 주소여야 합니다');
  }
  return v;
}

export function validateVesselProductInput(raw: unknown): VesselProductInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('용기 제품 형식이 올바르지 않습니다');
  const r = raw as Record<string, unknown>;
  const surface = r.surfaceTreatment ?? 'unknown';
  if (surface !== 'treated' && surface !== 'untreated' && surface !== 'unknown') return fail('표면 처리 값이 올바르지 않습니다');
  const specStatus = r.specStatus ?? 'reference';
  if (specStatus !== 'reference' && specStatus !== 'product_confirmed') return fail('사양 확인 상태가 올바르지 않습니다');
  const wells = r.wellsPerUnit ?? 1;
  if (typeof wells !== 'number' || !Number.isInteger(wells) || wells < 1 || wells > 1536) return fail('용기당 well 수는 1–1536 정수여야 합니다');
  const areaCm2PerWell = optPositive(r.areaCm2PerWell, 'well당 면적(cm²)', 10000);
  const mediumMinMlPerWell = optPositive(r.mediumMinMlPerWell, '권장 배지 최소 부피(mL/well)', 1000);
  const mediumMaxMlPerWell = optPositive(r.mediumMaxMlPerWell, '권장 배지 최대 부피(mL/well)', 1000);
  if (mediumMinMlPerWell !== null && mediumMaxMlPerWell !== null && mediumMinMlPerWell > mediumMaxMlPerWell)
    return fail('권장 배지 최소 부피가 최대 부피보다 클 수 없습니다');
  const sourceLabel = str(r.sourceLabel, '출처', 300);
  if ((mediumMinMlPerWell !== null || mediumMaxMlPerWell !== null) && !sourceLabel)
    return fail('권장 배지 부피를 입력하려면 출처를 적어야 합니다');
  if (specStatus === 'product_confirmed' && (areaCm2PerWell === null || !sourceLabel))
    return fail('제품 사양 확인으로 저장하려면 well당 면적과 출처가 필요합니다');
  return {
    label: str(r.label, '이름', 120, true),
    format: str(r.format, '형식', 80, true),
    manufacturer: str(r.manufacturer, '제조사', 120),
    catalogNo: str(r.catalogNo, '카탈로그 번호', 120),
    surfaceTreatment: surface,
    wellsPerUnit: wells,
    areaCm2PerWell,
    mediumMinMlPerWell,
    mediumMaxMlPerWell,
    specStatus,
    sourceLabel,
    url: optUrl(r.url),
  };
}

/** Parse a stored/frozen product object (no input rules, e.g. an old snapshot): same shape check, id kept. */
export function validateVesselProduct(raw: unknown): VesselProduct {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = str(r.id, 'ID', 120, true);
  return { id, ...validateVesselProductInput(raw) };
}

/** Shape-check a culture's vessel use. The product itself is resolved by the caller. */
export function validateVesselUse(raw: unknown): CultureVesselUse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('용기 사용 정보 형식이 올바르지 않습니다');
  const r = raw as Record<string, unknown>;
  const vesselProductId = str(r.vesselProductId, '용기 제품', 120, true);
  if (typeof r.usedWells !== 'number' || !Number.isInteger(r.usedWells) || r.usedWells < 1) return fail('사용한 well 수는 1 이상의 정수여야 합니다');
  let mediumMl: number | null = null;
  if (r.mediumMl !== undefined && r.mediumMl !== null) {
    if (typeof r.mediumMl !== 'number' || !Number.isFinite(r.mediumMl) || r.mediumMl <= 0 || r.mediumMl > 100000)
      return fail('배지 부피(mL)는 0보다 큰 숫자여야 합니다');
    mediumMl = r.mediumMl;
  }
  return { vesselProductId, usedWells: r.usedWells, mediumMl };
}

/** Used wells must fit in the product. Throws a Korean message otherwise. */
export function assertUsedWells(use: CultureVesselUse, product: VesselProduct): void {
  if (use.usedWells > product.wellsPerUnit) fail(`사용한 well 수(${use.usedWells})가 용기의 well 수(${product.wellsPerUnit})보다 많습니다`);
}

/** Total growth area (cm²) of the wells in use; null when the product has no area on record. */
export function vesselArea(product: Pick<VesselProduct, 'areaCm2PerWell'>, usedWells: number): number | null {
  if (!Number.isInteger(usedWells) || usedWells < 1) return fail('사용한 well 수는 1 이상의 정수여야 합니다');
  return product.areaCm2PerWell === null ? null : product.areaCm2PerWell * usedWells;
}

/** Short human text for a use, e.g. "12-well 3/12 well" (product label when not a plate). */
export function formatVesselUse(product: Pick<VesselProduct, 'label' | 'wellsPerUnit'>, usedWells: number): string {
  return product.wellsPerUnit > 1 ? `${product.label} · ${usedWells}/${product.wellsPerUnit} well` : product.label;
}

// ---------------------------------------------------------------------------------------------
// Medium / serum / antibiotic / reagent products
// ---------------------------------------------------------------------------------------------

export const MEDIUM_PRODUCT_KINDS = ['base_medium', 'serum', 'antibiotic', 'supplement', 'other'] as const;
export type MediumProductKind = (typeof MEDIUM_PRODUCT_KINDS)[number];
export const MEDIUM_KIND_LABELS: Record<MediumProductKind, string> = {
  base_medium: '기본 배지',
  serum: '혈청',
  antibiotic: '항생제',
  supplement: '첨가물',
  other: '기타 시약',
};
export interface ProductIngredient {
  label: string;
  value: number;
  unit: string;
}
export interface MediumProduct {
  id: string;
  kind: MediumProductKind;
  label: string;
  manufacturer: string;
  catalogNo: string;
  lotNo: string;
  /** Stock concentration of each ingredient as the user entered it (units free text, e.g. U/mL, µg/mL). */
  ingredients: ProductIngredient[];
  /** True only when the user explicitly confirmed the ingredient concentrations against the product. */
  ingredientsConfirmed: boolean;
  sourceLabel: string;
  url: string | null;
  createdAt: string;
  updatedAt: string;
}
export type MediumProductInput = Omit<MediumProduct, 'id' | 'createdAt' | 'updatedAt'>;
/** Frozen copy of a product stored inside a recipe, so later product edits never rewrite past recipes. */
export type MediumProductSnapshot = Omit<MediumProduct, 'createdAt' | 'updatedAt'> & { capturedAt: string };

export function validateIngredients(raw: unknown): ProductIngredient[] {
  if (!Array.isArray(raw) || raw.length > 30) return fail('성분은 30개 이하의 목록이어야 합니다');
  return raw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail('성분 형식이 올바르지 않습니다');
    const i = item as Record<string, unknown>;
    if (typeof i.value !== 'number' || !Number.isFinite(i.value) || i.value <= 0) return fail('성분 농도는 0보다 큰 숫자여야 합니다');
    return { label: str(i.label, '성분 이름', 300, true), value: i.value, unit: str(i.unit, '농도 단위', 100, true) };
  });
}

export function validateMediumProductInput(raw: unknown): MediumProductInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('배지·시약 제품 형식이 올바르지 않습니다');
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== 'string' || !(MEDIUM_PRODUCT_KINDS as readonly string[]).includes(r.kind)) return fail('제품 분류가 올바르지 않습니다');
  const ingredients = validateIngredients(r.ingredients ?? []);
  const ingredientsConfirmed = r.ingredientsConfirmed ?? false;
  if (typeof ingredientsConfirmed !== 'boolean') return fail('농도 확인 값이 올바르지 않습니다');
  if (ingredientsConfirmed && ingredients.length === 0) return fail('농도를 확인함으로 저장하려면 성분을 1개 이상 입력하세요');
  return {
    kind: r.kind as MediumProductKind,
    label: str(r.label, '제품 이름', 200, true),
    manufacturer: str(r.manufacturer, '제조사', 120),
    catalogNo: str(r.catalogNo, '카탈로그 번호', 120),
    lotNo: str(r.lotNo, 'Lot 번호', 120),
    ingredients,
    ingredientsConfirmed,
    sourceLabel: str(r.sourceLabel, '출처', 300),
    url: optUrl(r.url),
  };
}

export function snapshotMediumProduct(p: MediumProduct, capturedAt: string): MediumProductSnapshot {
  return {
    id: p.id,
    kind: p.kind,
    label: p.label,
    manufacturer: p.manufacturer,
    catalogNo: p.catalogNo,
    lotNo: p.lotNo,
    ingredients: p.ingredients.map((i) => ({ ...i })),
    ingredientsConfirmed: p.ingredientsConfirmed,
    sourceLabel: p.sourceLabel,
    url: p.url,
    capturedAt,
  };
}

export function validateMediumProductSnapshot(raw: unknown): MediumProductSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('제품 snapshot 형식이 올바르지 않습니다');
  const r = raw as Record<string, unknown>;
  return { id: str(r.id, '제품 ID', 120, true), ...validateMediumProductInput(raw), capturedAt: str(r.capturedAt, '기록 시각', 60, true) };
}
