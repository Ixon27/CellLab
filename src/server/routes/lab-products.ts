import { Hono, type Context } from 'hono';
import {
  isReferenceVesselId,
  MEDIUM_PRODUCT_KINDS,
  validateMediumProductInput,
  validateVesselProductInput,
  type MediumProductKind,
} from '../../shared/lab-products';
import { db } from '../db';
import { HttpError } from '../http-error';
import {
  getMediumProduct,
  getVesselProduct,
  insertMediumProduct,
  insertVesselProduct,
  listMediumProducts,
  listVesselProducts,
  updateMediumProduct,
  updateVesselProduct,
} from '../lab-products';

export const labProducts = new Hono();

async function bodyObject(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, '요청 본문이 올바른 JSON이 아닙니다');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '요청 본문이 올바르지 않습니다');
  return body as Record<string, unknown>;
}
function valid<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : '입력값이 올바르지 않습니다');
  }
}
function userVessel(id: string) {
  if (isReferenceVesselId(id)) throw new HttpError(400, '내장 참고 사양은 수정하거나 삭제할 수 없습니다. 복제해서 새 제품으로 저장하세요');
  const product = getVesselProduct(id);
  if (!product) throw new HttpError(404, '용기 제품을 찾을 수 없습니다');
  return product;
}
function mediumProduct(id: string) {
  const product = getMediumProduct(id);
  if (!product) throw new HttpError(404, '배지·시약 제품을 찾을 수 없습니다');
  return product;
}

// ---- vessels ---------------------------------------------------------------------------------

labProducts.get('/lab-products/vessels', (c) => c.json(listVesselProducts(c.req.query('reference') !== '0')));

labProducts.get('/lab-products/vessels/:id', (c) => {
  const product = getVesselProduct(c.req.param('id'));
  if (!product) throw new HttpError(404, '용기 제품을 찾을 수 없습니다');
  return c.json(product);
});

labProducts.post('/lab-products/vessels', async (c) => {
  const body = await bodyObject(c);
  return c.json(insertVesselProduct(valid(() => validateVesselProductInput(body))), 201);
});

labProducts.put('/lab-products/vessels/:id', async (c) => {
  const current = userVessel(c.req.param('id'));
  const body = await bodyObject(c);
  const { id: _id, ...rest } = current;
  return c.json(updateVesselProduct(current.id, valid(() => validateVesselProductInput({ ...rest, ...body }))));
});

labProducts.delete('/lab-products/vessels/:id', (c) => {
  const current = userVessel(c.req.param('id'));
  db.prepare('DELETE FROM lab_vessel_products WHERE id=?').run(current.id);
  return c.json({ ok: true });
});

// ---- medium / serum / antibiotic / reagent products ------------------------------------------

labProducts.get('/lab-products/media', (c) => {
  const kind = c.req.query('kind');
  if (kind !== undefined && !(MEDIUM_PRODUCT_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, '제품 분류가 올바르지 않습니다');
  return c.json(listMediumProducts(kind as MediumProductKind | undefined));
});

labProducts.get('/lab-products/media/:id', (c) => c.json(mediumProduct(c.req.param('id'))));

labProducts.post('/lab-products/media', async (c) => {
  const body = await bodyObject(c);
  return c.json(insertMediumProduct(valid(() => validateMediumProductInput(body))), 201);
});

labProducts.put('/lab-products/media/:id', async (c) => {
  const current = mediumProduct(c.req.param('id'));
  const body = await bodyObject(c);
  const { id: _id, createdAt: _created, updatedAt: _updated, ...rest } = current;
  return c.json(updateMediumProduct(current.id, valid(() => validateMediumProductInput({ ...rest, ...body }))));
});

labProducts.delete('/lab-products/media/:id', (c) => {
  const current = mediumProduct(c.req.param('id'));
  db.prepare('DELETE FROM lab_medium_products WHERE id=?').run(current.id);
  return c.json({ ok: true });
});
