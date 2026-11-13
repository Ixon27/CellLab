import type { CellLineDto, CultureStatus, ProfileDto } from '../../shared/cell-line';
import type { CultureFieldKey, CultureProfileFields } from '../../shared/culture';
import { completeMediumText } from '../../shared/culture';
import type { CultureExecutionPlan, PlanCondition, PlanSource, PlanStage, PlanStatus } from '../../shared/culture-plan';
import type { MediumProductSnapshot, VesselProduct } from '../../shared/lab-products';
import { executionProfile } from './culture-plan-state';

/**
 * Pure derivation for the "현재 배양 요약" card. Inputs are structural subsets of the API DTOs so the card keeps
 * working for legacy rows: nothing here invents a unit, time, volume or source that was not recorded.
 */

export interface SummaryCulture {
  id: string;
  label: string;
  passage: number;
  vessel: string;
  status: CultureStatus;
  profileId: string | null;
  startedAt: string;
  vesselUse?: { vesselProductId: string; usedWells: number; mediumMl: number | null; product: VesselProduct } | null;
}
export interface SummaryLog {
  id: string;
  cultureId: string;
  at: string;
  createdAt?: string;
  type: string;
  confluencyPct: number | null;
  feed?: {
    mode: string;
    removedMl: number | null;
    addedMl: number | null;
    mediumLabel: string | null;
    replacesMedium: boolean;
  } | null;
}

const DAY = 86400000;

/* ---------- culture choice ---------- */

export type CultureChoice = 'selected' | 'only_active' | 'needs_choice' | 'none_active';
/**
 * The summary describes ONE culture. With several active cultures nothing is assumed: the user must choose, and
 * values are never aggregated across cultures.
 */
export function resolveCurrentCulture<T extends Pick<SummaryCulture, 'id' | 'status'>>(
  cultures: T[],
  requestedId: string | null,
): { culture: T | null; choices: T[]; choice: CultureChoice } {
  const choices = cultures.filter((c) => c.status === 'active');
  const requested = requestedId ? choices.find((c) => c.id === requestedId) : undefined;
  if (requested) return { culture: requested, choices, choice: 'selected' };
  if (choices.length === 1) return { culture: choices[0], choices, choice: 'only_active' };
  return { culture: null, choices, choice: choices.length ? 'needs_choice' : 'none_active' };
}

/* ---------- time ---------- */

function time(at: string | undefined): number | null {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : null;
}
/** Newest first by event time, then creation time, then id. Logs with an unreadable time are dropped. */
function newest<T extends { id: string; at: string; createdAt?: string }>(logs: T[]): T[] {
  return logs
    .filter((l) => time(l.at) !== null)
    .sort((a, b) => time(b.at)! - time(a.at)! || (time(b.createdAt) ?? 0) - (time(a.createdAt) ?? 0) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0));
}
/** "3일 전" / "5시간 전" — always an elapsed statement, never a judgement. */
export function elapsedLabel(at: string, now: number): string | null {
  const t = time(at);
  if (t === null) return null;
  const ms = now - t;
  if (ms < 0) return '기록 시각이 현재보다 이후입니다';
  if (ms < 3600000) return '1시간 미만 전';
  if (ms < 2 * DAY) return `${Math.floor(ms / 3600000)}시간 전`;
  return `${Math.floor(ms / DAY)}일 전`;
}

/* ---------- source badges ---------- */

export type SourceKind = PlanSource['kind'] | 'unknown';
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  bank_reply: '분양처 답변',
  bank_general: '분양처 안내',
  paper: '논문',
  manufacturer: '제조사',
  lab: '실험실',
  unknown: '출처 미상',
};
export interface SourceBadge {
  kind: SourceKind;
  /** Registered source labels behind this badge (may be empty). */
  labels: string[];
}
/** Text shown on a badge; an empty reference list is stated as "미등록", not guessed. */
export function sourceBadgeText(b: SourceBadge): string {
  return b.kind === 'unknown' && b.labels.length === 0 ? '출처 미등록' : SOURCE_KIND_LABELS[b.kind];
}

/** Which plan conditions describe a value. Condition labels are free text, so matching is by label only. */
export type SourceTopic = 'medium' | 'temperature' | 'co2' | 'passage';
/** A condition about *when* to change medium is not a statement about what the medium is. */
const MEDIUM_CHANGE_LABEL = /교체|주기|change|exchange|refresh/i;
const TOPIC_LABELS: Record<Exclude<SourceTopic, 'passage'>, RegExp> = {
  medium: /배지|medium|media|혈청|serum|fbs|항생제|antibiotic/i,
  temperature: /온도|temperature|\btemp\b|°\s*c/i,
  co2: /co\s*[2₂]|이산화탄소|carbon dioxide/i,
};
function conditionsFor(plan: CultureExecutionPlan | null | undefined, topic: SourceTopic | null): PlanCondition[] {
  if (!plan || !topic) return [];
  if (topic === 'passage') return plan.conditions.filter((c) => c.stages.includes('passage'));
  return plan.conditions.filter((c) => TOPIC_LABELS[topic].test(c.label) && !(topic === 'medium' && MEDIUM_CHANGE_LABEL.test(c.label)));
}
function group(items: { kind: SourceKind; label: string }[]): SourceBadge[] {
  const map = new Map<SourceKind, string[]>();
  for (const { kind, label } of items) {
    const labels = map.get(kind) ?? [];
    if (label.trim() && !labels.includes(label.trim())) labels.push(label.trim());
    map.set(kind, labels);
  }
  return [...map].map(([kind, labels]) => ({ kind, labels }));
}
/**
 * Source badges for a value: (a) the profile's own source refs for these fields — their kind follows the profile
 * origin because refs carry no kind — and (b) sources of plan conditions whose label matches the topic.
 * Nothing found → a single "출처 미등록" badge.
 */
export function sourceBadges(profile: ProfileDto | null, fields: CultureFieldKey[], topic: SourceTopic | null): SourceBadge[] {
  const items: { kind: SourceKind; label: string }[] = [];
  const origin: SourceKind = profile?.origin === 'provider' ? 'bank_general' : profile?.origin === 'literature' ? 'paper' : 'unknown';
  for (const ref of profile?.sourceRefs ?? []) if (fields.includes(ref.field)) items.push({ kind: origin, label: ref.sourceLabel });
  for (const c of conditionsFor(profile?.executionPlan, topic)) for (const s of c.sources) items.push({ kind: s.kind, label: s.label });
  const out = group(items);
  return out.length ? out : [{ kind: 'unknown', labels: [] }];
}
function conditionBadges(c: PlanCondition): SourceBadge[] {
  const out = group(c.sources.map((s) => ({ kind: s.kind, label: s.label })));
  return out.length ? out : [{ kind: 'unknown', labels: [] }];
}

/* ---------- value rows ---------- */

export interface ValueRow {
  label: string;
  /** null = not registered. */
  value: string | null;
  /** Where the value text came from when it is not the profile field itself. */
  via: string | null;
  sources: SourceBadge[];
}
function numberText(v: unknown, unit: string): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? `${v}${unit}` : null;
}
function textValue(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function envRow(
  profile: ProfileDto | null,
  field: 'temp_c' | 'co2_pct',
  topic: 'temperature' | 'co2',
  label: string,
  unit: string,
): ValueRow {
  const own = numberText(profile?.fields[field], unit);
  const cond = own ? undefined : conditionsFor(profile?.executionPlan, topic).find((c) => c.value.trim());
  return {
    label,
    value: own ?? cond?.value.trim() ?? null,
    via: cond ? `실행 계획 조건 “${cond.label}”` : null,
    sources: cond ? conditionBadges(cond) : sourceBadges(profile, [field], null),
  };
}

/* ---------- medium ---------- */

export interface MediumPart {
  label: string;
  percent: number | null;
  /** Frozen snapshot saved with the plan — never re-read from the live product list. */
  product: MediumProductSnapshot | null;
  stockConfirmed: boolean | null;
}
export interface MediumView {
  text: string | null;
  parts: MediumPart[];
  sources: SourceBadge[];
}
type PlanRecipe = NonNullable<CultureExecutionPlan['mediumRecipe']>;
/** The plan's recipe plus the optional product snapshots Lab inventory may have saved with it. */
type RecipeLike = Omit<PlanRecipe, 'components'> & {
  baseProduct?: MediumProductSnapshot;
  components: (PlanRecipe['components'][number] & { product?: MediumProductSnapshot })[];
};
export function mediumView(profile: ProfileDto | null): MediumView {
  const recipe = (profile?.executionPlan?.mediumRecipe ?? null) as RecipeLike | null;
  const parts: MediumPart[] = recipe
    ? [
        { label: recipe.baseLabel, percent: null, product: recipe.baseProduct ?? null, stockConfirmed: null },
        ...recipe.components.map((c) => ({ label: c.label, percent: c.percent, product: c.product ?? null, stockConfirmed: c.stockConfirmed })),
      ]
    : [];
  const text = recipe
    ? [recipe.baseLabel, ...recipe.components.map((c) => `${c.label} ${c.percent}%`)].filter(Boolean).join(' + ')
    : completeMediumText((profile?.fields ?? {}) as CultureProfileFields) || null;
  return { text, parts, sources: recipe
    ? [{ kind: 'lab', labels: ['실행 계획에 등록한 조제 조성'] }]
    : sourceBadges(profile, ['base_medium', 'serum', 'serum_pct', 'supplements', 'antibiotics'], null) };
}
/** "제조사 · Cat. 12345 · Lot A1" — only what the snapshot actually holds. */
export function productNumbers(p: Pick<MediumProductSnapshot, 'manufacturer' | 'catalogNo' | 'lotNo'>): string {
  return [p.manufacturer, p.catalogNo && `Cat. ${p.catalogNo}`, p.lotNo && `Lot ${p.lotNo}`].filter(Boolean).join(' · ');
}

/* ---------- vessel ---------- */

export interface VesselView {
  /** false = only the free-text vessel exists (legacy): wells and medium volume were never recorded. */
  recorded: boolean;
  label: string;
  usedWells: number | null;
  wellsPerUnit: number | null;
  mediumMl: number | null;
  areaCm2: number | null;
  /** The product's own reference range — a stored spec, not a recommendation made here. */
  specMediumMlPerWell: { min: number | null; max: number | null } | null;
  specStatus: VesselProduct['specStatus'] | null;
  surfaceTreatment: VesselProduct['surfaceTreatment'] | null;
  productNumbers: string | null;
}
export function vesselView(culture: Pick<SummaryCulture, 'vessel' | 'vesselUse'>): VesselView {
  const use = culture.vesselUse;
  if (!use)
    return {
      recorded: false,
      label: culture.vessel,
      usedWells: null,
      wellsPerUnit: null,
      mediumMl: null,
      areaCm2: null,
      specMediumMlPerWell: null,
      specStatus: null,
      surfaceTreatment: null,
      productNumbers: null,
    };
  const p = use.product;
  const range = p.mediumMinMlPerWell !== null || p.mediumMaxMlPerWell !== null;
  return {
    recorded: true,
    label: p.label || culture.vessel,
    usedWells: use.usedWells,
    wellsPerUnit: p.wellsPerUnit,
    mediumMl: use.mediumMl,
    areaCm2: p.areaCm2PerWell === null ? null : Math.round(p.areaCm2PerWell * use.usedWells * 1000) / 1000,
    specMediumMlPerWell: range ? { min: p.mediumMinMlPerWell, max: p.mediumMaxMlPerWell } : null,
    specStatus: p.specStatus,
    surfaceTreatment: p.surfaceTreatment,
    productNumbers: [p.manufacturer, p.catalogNo && `Cat. ${p.catalogNo}`].filter(Boolean).join(' · ') || null,
  };
}

/* ---------- journal-derived observations ---------- */

/** A real replacement (full/partial/legacy-unspecified). Add-only feeds do not reset the replacement date. */
export function isReplacement(log: Pick<SummaryLog, 'type' | 'feed'>): boolean {
  return log.type === 'medium_change' && (log.feed ? log.feed.replacesMedium : true);
}
export function isAddition(log: Pick<SummaryLog, 'type' | 'feed'>): boolean {
  return log.type === 'medium_change' && !!log.feed && !log.feed.replacesMedium;
}
export const FEED_MODE_LABELS: Record<string, string> = {
  full: '전량 교체',
  partial: '부분 교체',
  addition: '첨가만',
  unspecified: '교체 방식 미기록',
};
export interface ReplacementView {
  at: string;
  elapsed: string | null;
  modeLabel: string;
  removedMl: number | null;
  addedMl: number | null;
  mediumLabel: string | null;
}
function replacementOf(log: SummaryLog): ReplacementView {
  return {
    at: log.at,
    elapsed: null,
    modeLabel: FEED_MODE_LABELS[log.feed?.mode ?? 'unspecified'] ?? FEED_MODE_LABELS.unspecified,
    removedMl: log.feed?.removedMl ?? null,
    addedMl: log.feed?.addedMl ?? null,
    mediumLabel: log.feed?.mediumLabel ?? null,
  };
}
export interface NextCheck {
  /** Medium-change interval entered in the condition set (days). */
  days: number;
  basisAt: string;
  dueAt: string;
  /** Whole days between "now" and the reference date: >0 remaining, 0 reached, <0 past. */
  remainingDays: number;
}
/** Reference date only: replacement date + the profile's `medium_change_days`. It never schedules or triggers anything. */
export function nextCheck(lastReplacementAt: string | null, days: number | null | undefined, now: number): NextCheck | null {
  const base = lastReplacementAt ? time(lastReplacementAt) : null;
  if (base === null || typeof days !== 'number' || !Number.isFinite(days) || days < 1) return null;
  return {
    days,
    basisAt: lastReplacementAt!,
    dueAt: new Date(base + days * DAY).toISOString(),
    remainingDays: days - Math.floor(Math.max(0, now - base) / DAY),
  };
}
export interface ConfluencyView {
  pct: number;
  at: string;
  elapsed: string | null;
}

/* ---------- passage criteria / unresolved conditions ---------- */

export interface CriterionRow {
  key: string;
  label: string;
  value: string;
  status: PlanStatus | null;
  sources: SourceBadge[];
}
export interface UnresolvedRow {
  id: string;
  label: string;
  value: string;
  status: PlanStatus;
  stages: PlanStage[];
}
const PASSAGE_FIELDS: { field: CultureFieldKey; label: string; unit?: string }[] = [
  { field: 'subculture_confluency_pct', label: '계대 시점 confluency', unit: '%' },
  { field: 'dissociation_reagent', label: '계대 시약' },
  { field: 'split_ratio', label: '분주 비율' },
  { field: 'seeding_density', label: '접종 밀도' },
];
export function isUnresolved(status: PlanStatus): boolean {
  return status === 'unresolved' || status === 'conditional';
}
/** Passage criteria registered in the (linked or active) condition set + non-open passage-stage plan conditions. */
export function passageCriteria(profile: ProfileDto | null, line: Pick<CellLineDto, 'maxPassage'>, culture: Pick<SummaryCulture, 'passage'> | null): CriterionRow[] {
  const rows: CriterionRow[] = [];
  for (const d of PASSAGE_FIELDS) {
    const raw = profile?.fields[d.field];
    const value = d.unit ? numberText(raw, d.unit) : textValue(raw);
    if (value) rows.push({ key: `field:${d.field}`, label: d.label, value, status: null, sources: sourceBadges(profile, [d.field], null) });
  }
  for (const c of conditionsFor(profile?.executionPlan, 'passage'))
    if (!isUnresolved(c.status)) rows.push({ key: `cond:${c.id}`, label: c.label || '(이름 없음)', value: c.value.trim() || '값 미입력', status: c.status, sources: conditionBadges(c) });
  if (line.maxPassage !== null)
    rows.push({
      key: 'line:max-passage',
      label: '세포주 최대 passage',
      value: culture ? `${line.maxPassage} (이 배양 P${culture.passage})` : String(line.maxPassage),
      status: null,
      sources: [{ kind: 'unknown', labels: [] }],
    });
  return rows;
}
/** Plan conditions still marked 미확인/조건부 — across all stages, never filled in with defaults. */
export function unresolvedConditions(profile: ProfileDto | null): UnresolvedRow[] {
  return (profile?.executionPlan?.conditions ?? [])
    .filter((c) => isUnresolved(c.status))
    .map((c) => ({ id: c.id, label: c.label || '(이름 없음)', value: c.value.trim(), status: c.status, stages: c.stages }));
}
/** The user's own judgement labels — wording never claims independent verification. */
export const CONDITION_STATUS_LABELS: Record<PlanStatus, string> = {
  confirmed: '입력상 확인',
  supported: '문헌·일반 근거',
  decision: '실험실 결정',
  conditional: '조건부',
  unresolved: '미확인',
};

/* ---------- whole view ---------- */

export type ProfileBasis = 'linked' | 'active_fallback' | 'active_no_culture' | 'none';
export interface CurrentCultureView {
  culture: SummaryCulture | null;
  choice: CultureChoice;
  choices: SummaryCulture[];
  profile: ProfileDto | null;
  profileBasis: ProfileBasis;
  medium: MediumView;
  temperature: ValueRow;
  co2: ValueRow;
  vessel: VesselView | null;
  /** `null` = the journal has no real replacement for this culture. Only meaningful when the journal loaded. */
  replacement: ReplacementView | null;
  /** Add-only feed newer than the replacement (or with no replacement at all), shown separately. */
  lastAddition: { at: string; elapsed: string | null } | null;
  nextCheck: NextCheck | null;
  /** Free-text interval from the condition set, shown only when no day count exists. */
  mediumChangeText: string | null;
  confluency: ConfluencyView | null;
  passageCriteria: CriterionRow[];
  unresolved: UnresolvedRow[];
}
export function buildCurrentCultureView(input: {
  line: Pick<CellLineDto, 'maxPassage'>;
  profiles: ProfileDto[];
  cultures: SummaryCulture[];
  logs: SummaryLog[];
  requestedCultureId: string | null;
  now: number;
}): CurrentCultureView {
  const { culture, choices, choice } = resolveCurrentCulture(input.cultures, input.requestedCultureId);
  const resolved = executionProfile(input.profiles, culture ?? undefined);
  const profile = resolved.profile;
  const profileBasis: ProfileBasis = !profile ? 'none' : !culture ? 'active_no_culture' : resolved.fallback ? 'active_fallback' : 'linked';
  const logs = culture ? newest(input.logs.filter((l) => l.cultureId === culture.id)) : [];
  const lastReplacement = logs.find(isReplacement) ?? null;
  const addition = logs.find(isAddition) ?? null;
  const lastAddition =
    addition && (!lastReplacement || (time(addition.at) ?? 0) > (time(lastReplacement.at) ?? 0))
      ? { at: addition.at, elapsed: elapsedLabel(addition.at, input.now) }
      : null;
  const conf = logs.find((l) => typeof l.confluencyPct === 'number' && Number.isFinite(l.confluencyPct));
  const days = profile?.fields.medium_change_days;
  const fields = profile?.fields;
  return {
    culture,
    choice,
    choices,
    profile,
    profileBasis,
    medium: mediumView(profile),
    temperature: envRow(profile, 'temp_c', 'temperature', '온도', ' °C'),
    co2: envRow(profile, 'co2_pct', 'co2', 'CO₂', '%'),
    vessel: culture ? vesselView(culture) : null,
    replacement: lastReplacement ? { ...replacementOf(lastReplacement), elapsed: elapsedLabel(lastReplacement.at, input.now) } : null,
    lastAddition,
    nextCheck: nextCheck(lastReplacement?.at ?? null, days, input.now),
    mediumChangeText: typeof days === 'number' ? null : textValue(fields?.medium_change),
    confluency: conf ? { pct: conf.confluencyPct!, at: conf.at, elapsed: elapsedLabel(conf.at, input.now) } : null,
    passageCriteria: passageCriteria(profile, input.line, culture),
    unresolved: unresolvedConditions(profile),
  };
}
