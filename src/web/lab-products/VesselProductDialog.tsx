import { useState } from 'react';
import { VESSEL_AREA_CM2 } from '../../shared/catalog';
import { SPEC_STATUS_LABELS, SURFACE_LABELS, type SurfaceTreatment, type VesselProduct, type VesselProductInput, type VesselSpecStatus } from '../../shared/lab-products';
import { api } from '../api';
import { Dialog, Field, inputCls, primaryBtnCls, btnCls } from '../components/Dialog';
import { invalidateLabProducts } from '../state/lab-products';

const numText = (n: number | null) => (n === null ? '' : String(n));
const parseOpt = (text: string): number | null => (text.trim() === '' ? null : Number(text));

/** Create or edit a user vessel product. `initial` without an id (e.g. cloned from a reference) creates a new one. */
export function VesselProductDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Partial<VesselProduct> | null;
  onClose(): void;
  onSaved(product: VesselProduct): void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [format, setFormat] = useState(initial?.format ?? '');
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? '');
  const [catalogNo, setCatalogNo] = useState(initial?.catalogNo ?? '');
  const [surface, setSurface] = useState<SurfaceTreatment>(initial?.surfaceTreatment ?? 'unknown');
  const [wells, setWells] = useState(String(initial?.wellsPerUnit ?? 1));
  const [area, setArea] = useState(numText(initial?.areaCm2PerWell ?? null));
  const [mediumMin, setMediumMin] = useState(numText(initial?.mediumMinMlPerWell ?? null));
  const [mediumMax, setMediumMax] = useState(numText(initial?.mediumMaxMlPerWell ?? null));
  const [specStatus, setSpecStatus] = useState<VesselSpecStatus>(initial?.specStatus ?? 'reference');
  const [sourceLabel, setSourceLabel] = useState(initial?.sourceLabel ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(initial?.id);

  const save = async () => {
    const body: VesselProductInput = {
      label,
      format,
      manufacturer,
      catalogNo,
      surfaceTreatment: surface,
      wellsPerUnit: Number(wells),
      areaCm2PerWell: parseOpt(area),
      mediumMinMlPerWell: parseOpt(mediumMin),
      mediumMaxMlPerWell: parseOpt(mediumMax),
      specStatus,
      sourceLabel,
      url: url.trim() || null,
    };
    setBusy(true);
    setError(null);
    try {
      const saved = await api<VesselProduct>(editing ? `/api/lab-products/vessels/${initial!.id}` : '/api/lab-products/vessels', {
        method: editing ? 'PUT' : 'POST',
        json: body,
      });
      invalidateLabProducts();
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={editing ? '용기 제품 수정' : '용기 제품 등록'}
      width={640}
      onClose={onClose}
      footer={(close) => (
        <>
          <button className={btnCls} onClick={close}>
            취소
          </button>
          <button className={primaryBtnCls} disabled={busy} onClick={() => void save()}>
            저장
          </button>
        </>
      )}
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="이름">
          <input className={inputCls} aria-label="이름" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="형식" hint="예: 12-well, 6-well, 60 mm dish, 100 mm dish 또는 직접 입력">
          <input className={inputCls} aria-label="형식" list="vessel-format-options" maxLength={80} value={format} onChange={(e) => setFormat(e.target.value)} />
          <datalist id="vessel-format-options">
            {Object.keys(VESSEL_AREA_CM2).map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Field>
        <Field label="제조사">
          <input className={inputCls} aria-label="제조사" maxLength={120} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
        </Field>
        <Field label="카탈로그 번호">
          <input className={inputCls} aria-label="카탈로그 번호" maxLength={120} value={catalogNo} onChange={(e) => setCatalogNo(e.target.value)} />
        </Field>
        <Field label="표면 처리" hint="제품 사양에서 확인한 값만 선택하세요. 모르면 미확인으로 두세요.">
          <select className={inputCls} aria-label="표면 처리" value={surface} onChange={(e) => setSurface(e.target.value as SurfaceTreatment)}>
            {(Object.keys(SURFACE_LABELS) as SurfaceTreatment[]).map((s) => (
              <option key={s} value={s}>
                {SURFACE_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="용기당 well 수" hint="플라스크·dish는 1">
          <input className={inputCls} aria-label="용기당 well 수" type="number" min={1} step={1} value={wells} onChange={(e) => setWells(e.target.value)} />
        </Field>
        <Field label="well당 배양 면적 (cm²)">
          <input className={inputCls} aria-label="well당 면적" type="number" min={0} step="any" value={area} onChange={(e) => setArea(e.target.value)} />
        </Field>
        <Field label="사양 상태" hint="제품 사양 확인은 면적과 출처가 있어야 저장됩니다.">
          <select className={inputCls} aria-label="사양 상태" value={specStatus} onChange={(e) => setSpecStatus(e.target.value as VesselSpecStatus)}>
            {(Object.keys(SPEC_STATUS_LABELS) as VesselSpecStatus[]).map((s) => (
              <option key={s} value={s}>
                {SPEC_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="권장 배지 최소 (mL/well)" hint="제품 사양에 있을 때만 입력. 비워 두면 미등록입니다.">
          <input className={inputCls} aria-label="권장 배지 최소" type="number" min={0} step="any" value={mediumMin} onChange={(e) => setMediumMin(e.target.value)} />
        </Field>
        <Field label="권장 배지 최대 (mL/well)">
          <input className={inputCls} aria-label="권장 배지 최대" type="number" min={0} step="any" value={mediumMax} onChange={(e) => setMediumMax(e.target.value)} />
        </Field>
        <Field label="출처" hint="면적·권장 부피를 확인한 자료 (제품 페이지, 데이터시트 등)">
          <input className={inputCls} aria-label="출처" maxLength={300} value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
        </Field>
        <Field label="출처 URL">
          <input className={inputCls} aria-label="출처 URL" maxLength={2000} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
      </div>
      {error && (
        <p className="text-[12.5px] text-danger" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
