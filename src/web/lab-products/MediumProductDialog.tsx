import { useState } from 'react';
import { MEDIUM_KIND_LABELS, MEDIUM_PRODUCT_KINDS, type MediumProduct, type MediumProductInput, type MediumProductKind } from '../../shared/lab-products';
import { api } from '../api';
import { Dialog, Field, btnCls, dangerBtnCls, inputCls, primaryBtnCls } from '../components/Dialog';
import { invalidateLabProducts } from '../state/lab-products';

const UNIT_SUGGESTIONS = ['U/mL', 'µg/mL', 'mg/mL', 'ng/mL', 'mM', 'µM', '%', 'x'];
interface IngredientDraft {
  label: string;
  value: string;
  unit: string;
}

/** Create or edit a medium / serum / antibiotic / reagent product with its stock ingredient concentrations. */
export function MediumProductDialog({
  initial,
  defaultKind = 'base_medium',
  onClose,
  onSaved,
}: {
  initial: MediumProduct | null;
  defaultKind?: MediumProductKind;
  onClose(): void;
  onSaved(product: MediumProduct): void;
}) {
  const [kind, setKind] = useState<MediumProductKind>(initial?.kind ?? defaultKind);
  const [label, setLabel] = useState(initial?.label ?? '');
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? '');
  const [catalogNo, setCatalogNo] = useState(initial?.catalogNo ?? '');
  const [lotNo, setLotNo] = useState(initial?.lotNo ?? '');
  const [ingredients, setIngredients] = useState<IngredientDraft[]>(
    initial?.ingredients.map((i) => ({ label: i.label, value: String(i.value), unit: i.unit })) ?? [],
  );
  const [confirmed, setConfirmed] = useState(initial?.ingredientsConfirmed ?? false);
  const [strength, setStrength] = useState(initial?.strengthX == null ? '1' : String(initial.strengthX));
  const [sourceLabel, setSourceLabel] = useState(initial?.sourceLabel ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (index: number, change: Partial<IngredientDraft>) =>
    setIngredients((list) => list.map((item, i) => (i === index ? { ...item, ...change } : item)));

  const save = async () => {
    const body: MediumProductInput = {
      kind,
      label,
      manufacturer,
      catalogNo,
      lotNo,
      ingredients: ingredients.map((i) => ({ label: i.label, value: i.value.trim() === '' ? NaN : Number(i.value), unit: i.unit })),
      ingredientsConfirmed: confirmed,
      strengthX: kind === 'freezing_medium' && strength.trim() ? Number(strength) : null,
      sourceLabel,
      url: url.trim() || null,
    };
    setBusy(true);
    setError(null);
    try {
      const saved = await api<MediumProduct>(initial ? `/api/lab-products/media/${initial.id}` : '/api/lab-products/media', {
        method: initial ? 'PUT' : 'POST',
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
      title={initial ? '배지·시약 제품 수정' : '배지·시약 제품 등록'}
      width={680}
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
        <Field label="분류">
          <select className={inputCls} aria-label="분류" value={kind} onChange={(e) => setKind(e.target.value as MediumProductKind)}>
            {MEDIUM_PRODUCT_KINDS.map((k) => (
              <option key={k} value={k}>
                {MEDIUM_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="제품 이름">
          <input className={inputCls} aria-label="제품 이름" maxLength={200} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        {kind === 'freezing_medium' && (
          <Field label="사용 농도 (X)" hint="완제품(바로 사용)은 1X, 세포액과 1:1로 섞는 2배 농도 배지는 2X. 동결 계산의 동결 배지 양이 이 값으로 정해집니다.">
            <input
              className={inputCls}
              aria-label="사용 농도 (X)"
              type="number"
              min={1}
              max={20}
              step="any"
              value={strength}
              onChange={(e) => setStrength(e.target.value)}
            />
          </Field>
        )}
        <Field label="제조사">
          <input className={inputCls} aria-label="제조사" maxLength={120} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
        </Field>
        <Field label="카탈로그 번호">
          <input className={inputCls} aria-label="카탈로그 번호" maxLength={120} value={catalogNo} onChange={(e) => setCatalogNo(e.target.value)} />
        </Field>
        <Field label="Lot 번호" hint="Lot마다 농도가 다르면 Lot별로 따로 등록하세요.">
          <input className={inputCls} aria-label="Lot 번호" maxLength={120} value={lotNo} onChange={(e) => setLotNo(e.target.value)} />
        </Field>
        <Field label="출처">
          <input className={inputCls} aria-label="출처" maxLength={300} placeholder="제품 라벨, 데이터시트 등" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
        </Field>
        <Field label="출처 URL">
          <input className={inputCls} aria-label="출처 URL" maxLength={2000} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
      </div>
      <fieldset className="mt-1 grid gap-2 rounded-lg border border-line p-3">
        <legend className="px-1 text-[12.5px] font-medium text-fg">Stock 성분 농도</legend>
        <datalist id="ingredient-units">
          {UNIT_SUGGESTIONS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        {ingredients.length === 0 && <p className="text-[12px] text-fg-muted">등록된 성분이 없습니다. 값을 모르면 비워 두세요 (임의 값은 넣지 않습니다).</p>}
        {ingredients.map((ingredient, i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_6rem_auto] items-end gap-2">
            <label className="grid gap-1 text-[11.5px] text-fg-muted">
              성분
              <input className={inputCls} aria-label={`성분 ${i + 1} 이름`} maxLength={300} value={ingredient.label} onChange={(e) => patch(i, { label: e.target.value })} />
            </label>
            <label className="grid gap-1 text-[11.5px] text-fg-muted">
              농도
              <input className={inputCls} aria-label={`성분 ${i + 1} 농도`} type="number" min={0} step="any" value={ingredient.value} onChange={(e) => patch(i, { value: e.target.value })} />
            </label>
            <label className="grid gap-1 text-[11.5px] text-fg-muted">
              단위
              <input className={inputCls} aria-label={`성분 ${i + 1} 단위`} list="ingredient-units" maxLength={100} value={ingredient.unit} onChange={(e) => patch(i, { unit: e.target.value })} />
            </label>
            <button className={dangerBtnCls} aria-label={`성분 ${i + 1} 제거`} onClick={() => setIngredients((list) => list.filter((_, n) => n !== i))}>
              제거
            </button>
          </div>
        ))}
        <div>
          <button className={btnCls} disabled={ingredients.length >= 30} onClick={() => setIngredients((list) => [...list, { label: '', value: '', unit: '' }])}>
            성분 추가
          </button>
        </div>
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            제품 라벨·데이터시트로 위 농도를 직접 확인함
            <span className="block text-[12px] text-fg-muted">확인한 제품만 조제 계산에서 최종 농도(U/mL, µg/mL 등)를 표시합니다.</span>
          </span>
        </label>
      </fieldset>
      {error && (
        <p className="mt-3 text-[12.5px] text-danger" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
