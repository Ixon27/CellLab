import { useState } from 'react';
import type { CultureExecutionPlan } from '../../shared/culture-plan';
import { snapshotMediumProduct, type MediumProduct, type MediumProductKind, type MediumProductSnapshot } from '../../shared/lab-products';
import { btnCls, dangerBtnCls, inputCls } from '../components/Dialog';
import { ConfirmedBadge, MediumProductPicker, productDetailText, type MediumProductChoice } from '../components/MediumProductPicker';
import { MediumProductDialog } from '../lab-products/MediumProductDialog';
import { useMediumProducts } from '../state/lab-products';

type Recipe = NonNullable<CultureExecutionPlan['mediumRecipe']>;
type Component = Recipe['components'][number];

const frozen = (p: MediumProduct) => snapshotMediumProduct(p, new Date().toISOString());
const sameProduct = (snapshot: MediumProductSnapshot, current: MediumProduct) =>
  snapshot.label === current.label &&
  snapshot.kind === current.kind &&
  snapshot.manufacturer === current.manufacturer &&
  snapshot.catalogNo === current.catalogNo &&
  snapshot.lotNo === current.lotNo &&
  snapshot.ingredientsConfirmed === current.ingredientsConfirmed &&
  JSON.stringify(snapshot.ingredients) === JSON.stringify(current.ingredients);

/** A linked product changed (or vanished) after this recipe froze it. Never applied implicitly. */
function ProductDrift({ snapshot, current, onRefresh }: { snapshot: MediumProductSnapshot; current: MediumProduct | null | undefined; onRefresh(p: MediumProduct): void }) {
  if (current === undefined) return null;
  if (current === null)
    return <p className="text-[12px] text-fg-muted">제품이 목록에서 삭제되었습니다. 이 계획에는 {snapshot.capturedAt.slice(0, 10)}에 저장된 제품 정보가 보존됩니다.</p>;
  if (sameProduct(snapshot, current)) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-[12px] text-warning">
      제품 정보가 저장 이후 수정되었습니다. 이 계획은 {snapshot.capturedAt.slice(0, 10)} 당시 값을 계속 사용합니다.
      <button className={btnCls} onClick={() => onRefresh(current)}>
        현재 제품 값으로 갱신
      </button>
    </p>
  );
}

function SnapshotSummary({ snapshot }: { snapshot: MediumProductSnapshot }) {
  return (
    <div className="grid gap-1 text-[12px] text-fg-muted" data-testid="recipe-product-summary">
      <p className="flex flex-wrap items-center gap-2">
        {productDetailText(snapshot) || '제조사·카탈로그 번호 미등록'}
        <ConfirmedBadge confirmed={snapshot.ingredientsConfirmed} />
      </p>
      {snapshot.ingredients.length > 0 && <p>Stock: {snapshot.ingredients.map((i) => `${i.label} ${i.value} ${i.unit}`).join(' · ')}</p>}
    </div>
  );
}

export function MediumRecipeEditor({ recipe, onChange }: { recipe: Recipe | null; onChange(next: Recipe | null): void }) {
  const { items } = useMediumProducts();
  const [registering, setRegistering] = useState<{ target: 'base' | number; kind: MediumProductKind } | null>(null);
  const lookup = (id: string) => (items ? (items.find((p) => p.id === id) ?? null) : undefined);

  const setComponent = (index: number, next: Component) =>
    recipe && onChange({ ...recipe, components: recipe.components.map((c, i) => (i === index ? next : c)) });

  const linkBase = (r: Recipe, product: MediumProduct): Recipe => ({ ...r, baseLabel: product.label, baseProductId: product.id, baseProduct: frozen(product) });
  const linkComponent = (c: Component, product: MediumProduct): Component => ({
    ...c,
    label: product.label,
    productId: product.id,
    product: frozen(product),
    stockIngredients: product.ingredients.map((i) => ({ ...i })),
    stockConfirmed: product.ingredientsConfirmed,
  });
  const unlinkComponent = (c: Component, label: string): Component => {
    const { productId: _id, product: _product, ...rest } = c;
    // A manual component must be explicitly re-confirmed.
    return { ...rest, label, stockConfirmed: false };
  };

  if (!recipe) return null;
  const total = recipe.components.reduce((sum, c) => sum + (Number.isFinite(c.percent) ? c.percent : 0), 0);

  const chooseBase = (choice: MediumProductChoice) => {
    if (choice.product) return onChange(linkBase(recipe, choice.product));
    const { baseProductId: _id, baseProduct: _product, ...rest } = recipe;
    onChange({ ...rest, baseLabel: choice.label });
  };
  const chooseComponent = (index: number, c: Component, choice: MediumProductChoice) =>
    setComponent(index, choice.product ? linkComponent(c, choice.product) : c.productId ? unlinkComponent(c, choice.label) : { ...c, label: choice.label });

  return (
    <>
      <fieldset className="grid gap-2 rounded-lg border border-line p-3">
        <legend className="px-1 text-sm">기본 배지</legend>
        <MediumProductPicker
          ariaLabel="기본 배지 제품"
          kind="base_medium"
          value={recipe.baseProductId ?? null}
          label={recipe.baseLabel}
          placeholder="기본 배지 이름"
          onChange={chooseBase}
        />
        {recipe.baseProduct && (
          <>
            <SnapshotSummary snapshot={recipe.baseProduct} />
            <ProductDrift snapshot={recipe.baseProduct} current={lookup(recipe.baseProduct.id)} onRefresh={(p) => onChange(linkBase(recipe, p))} />
          </>
        )}
        <div>
          <button className={btnCls} onClick={() => setRegistering({ target: 'base', kind: 'base_medium' })}>
            새 기본 배지 제품 등록
          </button>
        </div>
      </fieldset>
      <p className="text-xs text-fg-muted">
        각 첨가 성분의 최종 부피 비율을 입력합니다. 전체 비율 합은 100% 미만이어야 하며 나머지는 기본 배지입니다 (현재 첨가 합계 {Number(total.toFixed(4))}%).
        부피는 항상 mL로 계산합니다. 제품의 농도를 확인함으로 등록한 경우에만 최종 농도(U/mL, µg/mL 등)를 표시합니다.
      </p>
      {recipe.components.map((c, ci) => (
        <fieldset key={c.id} className="grid gap-3 rounded-lg border border-line p-3">
          <legend className="text-sm">조성 성분 {ci + 1}</legend>
          <div className="grid gap-1 text-sm">
            제품·성분
            <MediumProductPicker ariaLabel={`조성 성분 ${ci + 1} 제품`} value={c.productId ?? null} label={c.label} onChange={(choice) => chooseComponent(ci, c, choice)} />
          </div>
          {c.product && (
            <>
              <SnapshotSummary snapshot={c.product} />
              <ProductDrift snapshot={c.product} current={lookup(c.product.id)} onRefresh={(p) => setComponent(ci, linkComponent(c, p))} />
            </>
          )}
          <label className="grid gap-1 text-sm">
            최종 부피 비율 (%)
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              className={inputCls}
              value={c.percent}
              onChange={(e) => setComponent(ci, { ...c, percent: Number(e.target.value) })}
            />
          </label>
          {c.product ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={c.stockConfirmed}
                disabled={!c.product.ingredientsConfirmed}
                onChange={(e) => setComponent(ci, { ...c, stockConfirmed: e.target.checked })}
              />
              확인된 제품 농도로 최종 농도 표시
              {!c.product.ingredientsConfirmed && <span className="text-xs text-warning">제품의 농도가 확인되지 않아 표시할 수 없습니다</span>}
            </label>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={c.stockConfirmed} onChange={(e) => setComponent(ci, { ...c, stockConfirmed: e.target.checked })} />
                실제 제품 stock 농도를 확인함
              </label>
              {c.stockIngredients.map((ingredient, ii) => (
                <div key={ii} className="grid gap-2 sm:grid-cols-3">
                  {(['label', 'value', 'unit'] as const).map((key) => (
                    <label key={key} className="grid gap-1 text-xs">
                      {{ label: 'Stock 내 성분', value: 'Stock 농도', unit: '농도 단위' }[key]}
                      <input
                        className={inputCls}
                        type={key === 'value' ? 'number' : 'text'}
                        step="any"
                        value={ingredient[key]}
                        onChange={(e) =>
                          setComponent(ci, {
                            ...c,
                            stockIngredients: c.stockIngredients.map((item, i) =>
                              i === ii ? { ...item, [key]: key === 'value' ? Number(e.target.value) : e.target.value } : item,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                  <button className={dangerBtnCls} onClick={() => setComponent(ci, { ...c, stockIngredients: c.stockIngredients.filter((_, i) => i !== ii) })}>
                    Stock 성분 제거
                  </button>
                </div>
              ))}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {!c.product && (
              <button
                className={btnCls}
                disabled={c.stockIngredients.length >= 30}
                onClick={() => setComponent(ci, { ...c, stockIngredients: [...c.stockIngredients, { label: '', value: 0, unit: '' }] })}
              >
                Stock 내 성분 추가
              </button>
            )}
            <button className={btnCls} onClick={() => setRegistering({ target: ci, kind: 'other' })}>
              새 제품으로 등록해 연결
            </button>
            <button className={dangerBtnCls} onClick={() => onChange({ ...recipe, components: recipe.components.filter((_, i) => i !== ci) })}>
              조성 성분 제거
            </button>
          </div>
        </fieldset>
      ))}
      <button
        className={btnCls}
        disabled={recipe.components.length >= 50}
        onClick={() =>
          onChange({
            ...recipe,
            components: [...recipe.components, { id: crypto.randomUUID(), label: '', percent: 0, stockConfirmed: false, stockIngredients: [] }],
          })
        }
      >
        조성 성분 추가
      </button>
      {registering && (
        <MediumProductDialog
          initial={null}
          defaultKind={registering.kind}
          onClose={() => setRegistering(null)}
          onSaved={(product) => {
            const { target } = registering;
            setRegistering(null);
            if (target === 'base') onChange(linkBase(recipe, product));
            else {
              const component = recipe.components[target];
              if (component) setComponent(target, linkComponent(component, product));
            }
          }}
        />
      )}
    </>
  );
}
