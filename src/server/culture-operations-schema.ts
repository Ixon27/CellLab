/**
 * Additive tables for culture operations (vessel use, observation photos, freeze lot details).
 * Executed once from db.ts after the base schema: `db.exec(CULTURE_OPERATION_DDL)`.
 * Every statement is idempotent; legacy cultures/lots/logs simply have no side rows.
 */
export const CULTURE_OPERATION_DDL = `
CREATE TABLE IF NOT EXISTS culture_vessel_use(
  culture_id TEXT PRIMARY KEY REFERENCES cultures(id) ON DELETE CASCADE,
  vessel_product_id TEXT NOT NULL,
  used_wells INTEGER NOT NULL CHECK(used_wells >= 1),
  medium_ml REAL CHECK(medium_ml IS NULL OR medium_ml > 0),
  snapshot TEXT NOT NULL,
  updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS culture_log_photos(
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES culture_logs(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS culture_log_photos_log ON culture_log_photos(log_id);
CREATE TABLE IF NOT EXISTS cryo_lot_details(
  lot_id TEXT PRIMARY KEY REFERENCES cryo_lots(id) ON DELETE CASCADE,
  freeze_plan TEXT,
  representative_thaw TEXT,
  recovery_status TEXT CHECK(recovery_status IN ('unverified','confirmed','poor')),
  recovery_observed_at TEXT,
  recovery_note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL);
`;
