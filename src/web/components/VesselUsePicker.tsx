import { useEffect, useMemo, useState } from 'react';
import {
  isReferenceVesselId,
  SPEC_STATUS_LABELS,
  SURFACE_LABELS,
  formatVesselUse,
  MAX_USED_WELLS,
  vesselArea,
  type CultureVesselUse,
  type VesselProduct,
} from '../../shared/lab-products';
import { useVesselProducts } from '../state/lab-products';
import { inputCls } from './Dialog';

const numberText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** Small status chips shared by the picker, the calculator and the inventory page. */
export function VesselSpecBadges({ product }: { product: VesselProduct }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[12px]">
      <span
        className={`rounded-full px-2 py-0.5 ${product.specStatus === 'reference' ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'}`}
      >
        {SPEC_STATUS_LABELS[product.specStatus]}
      </span>
      <span className={`rounded-full px-2 py-0.5 ${product.surfaceTreatment === 'unknown' ? 'bg-warning-soft text-warning' : 'bg-sunken text-fg-muted'}`}>
        {SURFACE_LABELS[product.surfaceTreatment]}
      </span>
    </span>
  );
}

/** "0.5–1 mL" style text for the recommended medium of the wells in use, or null if none is on record. */
export function mediumRangeText(product: VesselProduct, usedWells: number): string | null {
  const { mediumMinMlPerWell: min, mediumMaxMlPerWell: max } = product;
  if (min === null && max === null) return null;
  const n = (v: number) => Number((v * usedWells).toFixed(4));
  if (min !== null && max !== null) return min === max ? `${n(min)} mL` : `${n(min)}–${n(max)} mL`;
  return min !== null ? `${n(min)} mL 이상` : `${n(max as number)} mL 이하`;
}

/**
 * Choose a vessel product + how many of its wells a culture uses (+ optional medium volume in mL).
 * `onChange` gets `null` while nothing valid is selected: the caller's free-text vessel stays authoritative then,
 * and `legacyVessel` is only displayed, never overwritten.
 */
export function VesselUsePicker({
  value,
  onChange,
  legacyVessel,
  withMedium = true,
  finalVolume = false,
  disabled = false,
}: {
  value: CultureVesselUse | null;
  onChange(use: CultureVesselUse | null, product: VesselProduct | null): void;
  legacyVessel?: string;
  withMedium?: boolean;
  finalVolume?: boolean;
  disabled?: boolean;
}) {
  const { items, error } = useVesselProducts();
  const [productId, setProductId] = useState(value?.vesselProductId ?? '');
  const [wells, setWells] = useState(numberText(value?.usedWells));
  // Medium is typed per dish/well (all the same) and stored as the total over the vessels in use.
  const perVessel = (use: CultureVesselUse | null) =>
    use?.mediumMl == null || !use.usedWells ? '' : String(Number((use.mediumMl / use.usedWells).toPrecision(6)));
  const [medium, setMedium] = useState(() => perVessel(value));

  // Follow an external change (e.g. a dialog switching to another culture) without fighting local typing.
  useEffect(() => {
    if (!value) return;
    setProductId(value.vesselProductId);
    setWells((text) => (Number(text) === value.usedWells ? text : String(value.usedWells)));
    setMedium((text) =>
      text.trim() !== '' && value.mediumMl !== null && Math.abs(Number(text) * value.usedWells - value.mediumMl) < 1e-6 ? text : perVessel(value),
    );
  }, [value?.vesselProductId, value?.usedWells, value?.mediumMl]);

  const product = useMemo(() => items?.find((p) => p.id === productId) ?? null, [items, productId]);
  const usedWells = Number(wells);
  const wellsValid = wells.trim() !== '' && Number.isInteger(usedWells) && usedWells >= 1 && usedWells <= MAX_USED_WELLS;
  const countLabel = product && product.wellsPerUnit > 1 ? '사용한 well 수' : '용기 개수';
  const mediumNum = medium.trim() === '' ? null : Number(medium);
  const mediumValid = mediumNum === null || (Number.isFinite(mediumNum) && mediumNum > 0);

  const emit = (id: string, w: string, m: string) => {
    const p = items?.find((x) => x.id === id) ?? null;
    const n = Number(w);
    const mm = m.trim() === '' ? null : Number(m);
    const ok = p && w.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= MAX_USED_WELLS && (mm === null || (Number.isFinite(mm) && mm > 0));
    onChange(ok ? { vesselProductId: id, usedWells: n, mediumMl: withMedium && mm !== null ? mm * n : null } : null, ok ? p : null);
  };

  const area = product && wellsValid ? vesselArea(product, usedWells) : null;
  const range = product && wellsValid ? mediumRangeText(product, 1) : null;
  const mine = items?.filter((p) => !isReferenceVesselId(p.id)) ?? [];
  const refs = items?.filter((p) => isReferenceVesselId(p.id)) ?? [];

  return (
    <div className="grid gap-2" data-testid="vessel-use-picker">
      <label className="block text-[12px] font-medium text-fg">
        용기 제품
        <select
          className={`${inputCls} mt-1`}
          aria-label="용기 제품"
          disabled={disabled || !items}
          value={productId}
          onChange={(e) => {
            const next = items?.find((p) => p.id === e.target.value) ?? null;
            const nextWells = next && next.wellsPerUnit === 1 ? '1' : '';
            setProductId(e.target.value);
            setWells(nextWells);
            emit(e.target.value, nextWells, medium);
          }}
        >
          <option value="">선택 안 함 (자유 입력 유지)</option>
          {productId && items && !product && <option value={productId}>(삭제되었거나 찾을 수 없는 제품)</option>}
          {mine.length > 0 && (
            <optgroup label="내 용기 제품">
              {mine.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.manufacturer ? ` · ${p.manufacturer}` : ''}
                  {p.catalogNo ? ` ${p.catalogNo}` : ''}
                </option>
              ))}
            </optgroup>
          )}
          {refs.length > 0 && (
            <optgroup label="참고 사양 (미확인)">
              {refs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {error && <p className="text-[12px] text-danger">용기 목록을 불러오지 못했습니다: {error}</p>}
      {legacyVessel && !product && <p className="text-[12px] text-fg-muted">기존 자유 입력 용기: {legacyVessel} (그대로 유지됩니다)</p>}
      {product && (
        <>
          <div className={`grid gap-2 ${withMedium ? 'sm:grid-cols-2' : ''}`}>
            <label className="block text-[12px] font-medium text-fg">
              {countLabel}{' '}
              <span className="font-normal text-fg-muted">
                {product.wellsPerUnit > 1 ? `(plate당 ${product.wellsPerUnit} well · 여러 plate면 합계)` : '(dish·flask 몇 개)'}
              </span>
              <input
                className={`${inputCls} mt-1`}
                aria-label={countLabel}
                type="number"
                min={1}
                max={MAX_USED_WELLS}
                step={1}
                disabled={disabled}
                value={wells}
                onChange={(e) => {
                  setWells(e.target.value);
                  emit(productId, e.target.value, medium);
                }}
              />
            </label>
            {withMedium && (
              <label className="block text-[12px] font-medium text-fg">
                {product.wellsPerUnit > 1 ? 'well' : '용기'} 1개당 {finalVolume ? '최종 배양 부피' : '배지'} (mL, 선택)
                <input
                  className={`${inputCls} mt-1`}
                  aria-label={finalVolume ? '용기 1개당 최종 부피 mL' : '용기 1개당 배지 mL'}
                  type="number"
                  min={0}
                  step="any"
                  disabled={disabled}
                  value={medium}
                  onChange={(e) => {
                    setMedium(e.target.value);
                    emit(productId, wells, e.target.value);
                  }}
                />
              </label>
            )}
          </div>
          {!wellsValid && (
            <p className="text-[12px] text-warning">
              {wells.trim() === '' ? `${countLabel}를 입력하세요.` : `${countLabel}는 1–${MAX_USED_WELLS} 사이의 정수여야 합니다.`} 입력 전에는 구조화된 용기가 저장되지 않습니다.
            </p>
          )}
          {!mediumValid && <p className="text-[12px] text-warning">배지 부피는 0보다 큰 숫자(mL)여야 합니다.</p>}
          <div className="grid gap-1 rounded-lg bg-sunken px-3 py-2 text-[12px] text-fg-muted">
            {wellsValid && (
              <strong className="text-fg">
                {formatVesselUse(product, usedWells)}
                {mediumValid && mediumNum !== null && usedWells > 1 && ` · 배지 합계 ${Number((mediumNum * usedWells).toPrecision(6))} mL`}
              </strong>
            )}
            <VesselSpecBadges product={product} />
            <span>
              총 면적{' '}
              {area === null ? (
                <strong className="text-warning">{wellsValid ? '미등록 (계산 불가)' : '—'}</strong>
              ) : (
                <strong className="text-fg">{Number(area.toFixed(3))} cm²</strong>
              )}
              {product.areaCm2PerWell !== null && ` (${product.areaCm2PerWell} cm²/well)`}
            </span>
            <span>
              권장 배지{' '}
              {range ? (
                <>
                  <strong className="text-fg">{range}</strong> /{product.wellsPerUnit > 1 ? 'well' : '용기'} · 출처: {product.sourceLabel}
                </>
              ) : (
                '미등록 (제품 사양을 확인해 용기 제품에 입력하세요)'
              )}
            </span>
            {product.specStatus === 'reference' && <span className="text-warning">참고 면적은 제조사별로 다르며 제품 사양으로 확인되지 않았습니다.</span>}
            {product.surfaceTreatment === 'unknown' && <span className="text-warning">표면 처리(TC-treated 여부)가 확인되지 않았습니다.</span>}
          </div>
        </>
      )}
    </div>
  );
}
