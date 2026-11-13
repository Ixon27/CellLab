import { nanoid } from 'nanoid';
import {
  isReferenceVesselId,
  referenceVesselProduct,
  REFERENCE_VESSEL_PRODUCTS,
  validateIngredients,
  type MediumProduct,
  type MediumProductInput,
  type MediumProductKind,
  type VesselProduct,
  type VesselProductInput,
} from '../shared/lab-products';
import { db, now, parseJsonColumn } from './db';

interface VesselRow {
  id: string;
  label: string;
  format: string;
  manufacturer: string;
  catalog_no: string;
  surface_treatment: VesselProduct['surfaceTreatment'];
  wells_per_unit: number;
  area_cm2_per_well: number | null;
  medium_min_ml_per_well: number | null;
  medium_max_ml_per_well: number | null;
  spec_status: VesselProduct['specStatus'];
  source_label: string;
  url: string | null;
}
interface MediumRow {
  id: string;
  kind: MediumProductKind;
  label: string;
  manufacturer: string;
  catalog_no: string;
  lot_no: string;
  ingredients: string;
  ingredients_confirmed: number;
  source_label: string;
  url: string | null;
  created_at: string;
  updated_at: string;
}

export function toVesselProduct(r: VesselRow): VesselProduct {
  return {
    id: r.id,
    label: r.label,
    format: r.format,
    manufacturer: r.manufacturer,
    catalogNo: r.catalog_no,
    surfaceTreatment: r.surface_treatment,
    wellsPerUnit: r.wells_per_unit,
    areaCm2PerWell: r.area_cm2_per_well,
    mediumMinMlPerWell: r.medium_min_ml_per_well,
    mediumMaxMlPerWell: r.medium_max_ml_per_well,
    specStatus: r.spec_status,
    sourceLabel: r.source_label,
    url: r.url,
  };
}

export function toMediumProduct(r: MediumRow): MediumProduct {
  let ingredients: MediumProduct['ingredients'] = [];
  try {
    ingredients = validateIngredients(parseJsonColumn<unknown>(r.ingredients, []));
  } catch {
    // An unreadable stored list is shown as "no ingredients" and can never read as confirmed.
  }
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    manufacturer: r.manufacturer,
    catalogNo: r.catalog_no,
    lotNo: r.lot_no,
    ingredients,
    ingredientsConfirmed: r.ingredients_confirmed === 1 && ingredients.length > 0,
    sourceLabel: r.source_label,
    url: r.url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Built-in reference ids ('ref:…') and stored user products share one id space. */
export function getVesselProduct(id: string): VesselProduct | null {
  if (isReferenceVesselId(id)) return referenceVesselProduct(id);
  const row = db.prepare('SELECT * FROM lab_vessel_products WHERE id=?').get(id) as unknown as VesselRow | undefined;
  return row ? toVesselProduct(row) : null;
}

export function listVesselProducts(includeReference = true): VesselProduct[] {
  const rows = db.prepare('SELECT * FROM lab_vessel_products ORDER BY label COLLATE NOCASE, created_at').all() as unknown as VesselRow[];
  return [...(includeReference ? REFERENCE_VESSEL_PRODUCTS : []), ...rows.map(toVesselProduct)];
}

export function insertVesselProduct(input: VesselProductInput): VesselProduct {
  const id = nanoid(12);
  const at = now();
  db.prepare(
    `INSERT INTO lab_vessel_products(id,label,format,manufacturer,catalog_no,surface_treatment,wells_per_unit,area_cm2_per_well,
      medium_min_ml_per_well,medium_max_ml_per_well,spec_status,source_label,url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.label,
    input.format,
    input.manufacturer,
    input.catalogNo,
    input.surfaceTreatment,
    input.wellsPerUnit,
    input.areaCm2PerWell,
    input.mediumMinMlPerWell,
    input.mediumMaxMlPerWell,
    input.specStatus,
    input.sourceLabel,
    input.url,
    at,
    at,
  );
  return getVesselProduct(id)!;
}

export function updateVesselProduct(id: string, input: VesselProductInput): VesselProduct {
  db.prepare(
    `UPDATE lab_vessel_products SET label=?,format=?,manufacturer=?,catalog_no=?,surface_treatment=?,wells_per_unit=?,area_cm2_per_well=?,
      medium_min_ml_per_well=?,medium_max_ml_per_well=?,spec_status=?,source_label=?,url=?,updated_at=? WHERE id=?`,
  ).run(
    input.label,
    input.format,
    input.manufacturer,
    input.catalogNo,
    input.surfaceTreatment,
    input.wellsPerUnit,
    input.areaCm2PerWell,
    input.mediumMinMlPerWell,
    input.mediumMaxMlPerWell,
    input.specStatus,
    input.sourceLabel,
    input.url,
    now(),
    id,
  );
  return getVesselProduct(id)!;
}

export function getMediumProduct(id: string): MediumProduct | null {
  const row = db.prepare('SELECT * FROM lab_medium_products WHERE id=?').get(id) as unknown as MediumRow | undefined;
  return row ? toMediumProduct(row) : null;
}

export function listMediumProducts(kind?: MediumProductKind): MediumProduct[] {
  const rows = (
    kind
      ? db.prepare('SELECT * FROM lab_medium_products WHERE kind=? ORDER BY label COLLATE NOCASE, created_at').all(kind)
      : db.prepare('SELECT * FROM lab_medium_products ORDER BY kind, label COLLATE NOCASE, created_at').all()
  ) as unknown as MediumRow[];
  return rows.map(toMediumProduct);
}

export function insertMediumProduct(input: MediumProductInput): MediumProduct {
  const id = nanoid(12);
  const at = now();
  db.prepare(
    `INSERT INTO lab_medium_products(id,kind,label,manufacturer,catalog_no,lot_no,ingredients,ingredients_confirmed,source_label,url,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.kind,
    input.label,
    input.manufacturer,
    input.catalogNo,
    input.lotNo,
    JSON.stringify(input.ingredients),
    input.ingredientsConfirmed ? 1 : 0,
    input.sourceLabel,
    input.url,
    at,
    at,
  );
  return getMediumProduct(id)!;
}

export function updateMediumProduct(id: string, input: MediumProductInput): MediumProduct {
  db.prepare(
    `UPDATE lab_medium_products SET kind=?,label=?,manufacturer=?,catalog_no=?,lot_no=?,ingredients=?,ingredients_confirmed=?,source_label=?,url=?,updated_at=? WHERE id=?`,
  ).run(
    input.kind,
    input.label,
    input.manufacturer,
    input.catalogNo,
    input.lotNo,
    JSON.stringify(input.ingredients),
    input.ingredientsConfirmed ? 1 : 0,
    input.sourceLabel,
    input.url,
    now(),
    id,
  );
  return getMediumProduct(id)!;
}
