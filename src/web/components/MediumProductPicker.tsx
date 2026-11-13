import { MEDIUM_KIND_LABELS, type MediumProduct, type MediumProductKind } from '../../shared/lab-products';
import { useMediumProducts } from '../state/lab-products';
import { inputCls } from './Dialog';

export function productDetailText(p: Pick<MediumProduct, 'manufacturer' | 'catalogNo' | 'lotNo'>): string {
  return [p.manufacturer, p.catalogNo && `Cat. ${p.catalogNo}`, p.lotNo && `Lot ${p.lotNo}`].filter(Boolean).join(' · ');
}

export function ConfirmedBadge({ confirmed }: { confirmed: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11.5px] ${confirmed ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>
      {confirmed ? '농도 확인됨' : '농도 미확인'}
    </span>
  );
}

export interface MediumProductChoice {
  productId: string | null;
  label: string;
  product: MediumProduct | null;
}

/**
 * Pick a registered medium / serum / antibiotic / reagent product, or type a free label (productId null).
 * Registered products fill the label; the caller decides what to freeze from `product`.
 */
export function MediumProductPicker({
  value,
  label,
  onChange,
  kind,
  placeholder = '제품 이름을 직접 입력',
  ariaLabel = '제품',
  disabled = false,
}: {
  value: string | null;
  label: string;
  onChange(next: MediumProductChoice): void;
  kind?: MediumProductKind;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const { items, error } = useMediumProducts();
  const candidates = items?.filter((p) => !kind || p.kind === kind || p.id === value) ?? [];
  const selected = value ? (items?.find((p) => p.id === value) ?? null) : null;
  return (
    <div className="grid gap-1.5">
      <select
        className={inputCls}
        aria-label={`${ariaLabel} 선택`}
        disabled={disabled || !items}
        value={value ?? ''}
        onChange={(e) => {
          const product = items?.find((p) => p.id === e.target.value) ?? null;
          onChange({ productId: product ? product.id : null, label: product ? product.label : label, product });
        }}
      >
        <option value="">직접 입력 (제품 미연결)</option>
        {value && items && !selected && <option value={value}>(삭제되었거나 찾을 수 없는 제품)</option>}
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            [{MEDIUM_KIND_LABELS[p.kind]}] {p.label}
            {productDetailText(p) ? ` · ${productDetailText(p)}` : ''}
          </option>
        ))}
      </select>
      {error && <p className="text-[12px] text-danger">제품 목록을 불러오지 못했습니다: {error}</p>}
      {!value && (
        <input
          className={inputCls}
          aria-label={`${ariaLabel} 이름`}
          maxLength={300}
          placeholder={placeholder}
          disabled={disabled}
          value={label}
          onChange={(e) => onChange({ productId: null, label: e.target.value, product: null })}
        />
      )}
      {selected && (
        <p className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
          {productDetailText(selected) || '제조사·카탈로그 번호 미등록'}
          <ConfirmedBadge confirmed={selected.ingredientsConfirmed} />
        </p>
      )}
    </div>
  );
}
