import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  isReferenceVesselId,
  MEDIUM_KIND_LABELS,
  MEDIUM_PRODUCT_KINDS,
  type MediumProduct,
  type MediumProductKind,
  type VesselProduct,
} from '../../shared/lab-products';
import { api } from '../api';
import { chipCls, primaryBtnCls, smallIconBtnCls } from '../components/Dialog';
import { productDetailText, ConfirmedBadge } from '../components/MediumProductPicker';
import { useToast } from '../components/Toast';
import { VesselChangeCalculator } from '../components/VesselChangeCalculator';
import { mediumRangeText, VesselSpecBadges } from '../components/VesselUsePicker';
import { MediumProductDialog } from '../lab-products/MediumProductDialog';
import { VesselProductDialog } from '../lab-products/VesselProductDialog';
import { invalidateLabProducts, useMediumProducts, useVesselProducts } from '../state/lab-products';
import { PageHeader } from '../components/Workbench';

type Tab = 'vessels' | 'media' | 'calculator';
const TABS: { id: Tab; label: string }[] = [
  { id: 'vessels', label: '용기 제품' },
  { id: 'media', label: '배지·혈청·시약' },
  { id: 'calculator', label: '용기 변경 계산' },
];

export function LabProducts() {
  const [tab, setTab] = useState<Tab>('vessels');
  return (
    <div className="workbench-page">
      <PageHeader
        eyebrow="Reference"
        title="실험 용품"
        note="배양 용기와 배지·혈청·항생제 제품을 등록합니다. 값은 직접 입력하거나 확인한 것만 저장되며, 기록에는 입력 당시의 사양이 보존됩니다."
      />
      <div className="max-w-5xl">
        <div role="tablist" aria-label="실험 용품 분류" className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={chipCls(tab === t.id)} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-4">
          {tab === 'vessels' && <VesselProducts />}
          {tab === 'media' && <MediumProducts />}
          {tab === 'calculator' && <VesselChangeCalculator />}
        </div>
      </div>
    </div>
  );
}

function VesselProducts() {
  const { items, error } = useVesselProducts();
  const [editing, setEditing] = useState<Partial<VesselProduct> | 'new' | null>(null);
  const toast = useToast();
  const remove = async (p: VesselProduct) => {
    if (!confirm(`'${p.label}' 제품을 삭제할까요? 이미 기록된 배양의 용기 사양은 그대로 보존됩니다.`)) return;
    try {
      await api(`/api/lab-products/vessels/${p.id}`, { method: 'DELETE' });
      invalidateLabProducts();
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    }
  };
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-fg-muted">
          내장 항목은 앱 안의 Corning 기준 참고 면적이며 제품 사양으로 확인되지 않았습니다. 권장 배지 부피는 직접 입력하기 전까지 비어 있습니다.
        </p>
        <button className={`${primaryBtnCls} shrink-0`} onClick={() => setEditing('new')}>
          <Plus size={14} /> 용기 제품 등록
        </button>
      </div>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface" aria-label="용기 제품 목록">
        {!items && !error && <li className="px-4 py-3 text-[13px] text-fg-muted">불러오는 중…</li>}
        {items?.map((p) => {
          const reference = isReferenceVesselId(p.id);
          return (
            <li key={p.id} className="flex items-start gap-3 px-4 py-3" data-testid="vessel-product-row">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-fg">
                  {p.label}
                  <span className="ml-2 text-[12px] font-normal text-fg-dim">
                    {p.format} · {p.wellsPerUnit} well
                  </span>
                </p>
                <p className="mt-0.5 text-[12px] text-fg-muted">
                  {productDetailText({ manufacturer: p.manufacturer, catalogNo: p.catalogNo, lotNo: '' }) || '제조사·카탈로그 번호 미등록'}
                  {' · '}
                  {p.areaCm2PerWell === null ? '면적 미등록' : `${p.areaCm2PerWell} cm²/well`}
                  {' · 권장 배지 '}
                  {mediumRangeText(p, 1) ?? '미등록'}
                  {mediumRangeText(p, 1) ? '/well' : ''}
                </p>
                <div className="mt-1.5">
                  <VesselSpecBadges product={p} />
                </div>
              </div>
              <button className={smallIconBtnCls} aria-label={`${p.label} 복제`} title="복제해서 새 제품으로" onClick={() => setEditing({ ...p, id: undefined, label: reference ? p.format : `${p.label} 사본` })}>
                <Copy size={14} />
              </button>
              {!reference && (
                <>
                  <button className={smallIconBtnCls} aria-label={`${p.label} 수정`} title="수정" onClick={() => setEditing(p)}>
                    <Pencil size={14} />
                  </button>
                  <button className={smallIconBtnCls} aria-label={`${p.label} 삭제`} title="삭제" onClick={() => void remove(p)}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {editing && (
        <VesselProductDialog
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast('용기 제품을 저장했습니다');
          }}
        />
      )}
    </section>
  );
}

function MediumProducts() {
  const { items, error } = useMediumProducts();
  const [kind, setKind] = useState<MediumProductKind | 'all'>('all');
  const [editing, setEditing] = useState<MediumProduct | 'new' | null>(null);
  const toast = useToast();
  const shown = items?.filter((p) => kind === 'all' || p.kind === kind);
  const remove = async (p: MediumProduct) => {
    if (!confirm(`'${p.label}' 제품을 삭제할까요? 이미 저장된 조제 계획의 제품 정보는 그대로 보존됩니다.`)) return;
    try {
      await api(`/api/lab-products/media/${p.id}`, { method: 'DELETE' });
      invalidateLabProducts();
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    }
  };
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="제품 분류" className="flex flex-wrap gap-1.5">
          <button className={chipCls(kind === 'all')} aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
            전체
          </button>
          {MEDIUM_PRODUCT_KINDS.map((k) => (
            <button key={k} className={chipCls(kind === k)} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {MEDIUM_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <button className={`${primaryBtnCls} shrink-0`} onClick={() => setEditing('new')}>
          <Plus size={14} /> 제품 등록
        </button>
      </div>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface" aria-label="배지·시약 제품 목록">
        {!items && !error && <li className="px-4 py-3 text-[13px] text-fg-muted">불러오는 중…</li>}
        {shown?.length === 0 && <li className="px-4 py-3 text-[13px] text-fg-muted">등록된 제품이 없습니다.</li>}
        {shown?.map((p) => (
          <li key={p.id} className="flex items-start gap-3 px-4 py-3" data-testid="medium-product-row">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-fg">
                {p.label}
                <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 text-[11.5px] font-normal text-fg-muted">{MEDIUM_KIND_LABELS[p.kind]}</span>
              </p>
              <p className="mt-0.5 text-[12px] text-fg-muted">{productDetailText(p) || '제조사·카탈로그 번호 미등록'}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
                <ConfirmedBadge confirmed={p.ingredientsConfirmed} />
                {p.ingredients.length === 0
                  ? '성분 농도 미등록'
                  : p.ingredients.map((i) => `${i.label} ${i.value} ${i.unit}`).join(' · ')}
              </p>
            </div>
            <button className={smallIconBtnCls} aria-label={`${p.label} 수정`} title="수정" onClick={() => setEditing(p)}>
              <Pencil size={14} />
            </button>
            <button className={smallIconBtnCls} aria-label={`${p.label} 삭제`} title="삭제" onClick={() => void remove(p)}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <MediumProductDialog
          initial={editing === 'new' ? null : editing}
          defaultKind={kind === 'all' ? undefined : kind}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast('제품을 저장했습니다');
          }}
        />
      )}
    </section>
  );
}
