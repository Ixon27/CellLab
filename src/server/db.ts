import { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { PATHS } from './config';
import { seedBuiltins } from './seed';
import { CULTURE_OPERATION_DDL } from './culture-operations-schema';

export const db = new DatabaseSync(PATHS.db);

const culturePlatesDdl = `CREATE TABLE IF NOT EXISTS culture_plates(
  culture_id TEXT NOT NULL REFERENCES cultures(id) ON DELETE CASCADE,
  plate_no INTEGER NOT NULL CHECK(plate_no >= 1),
  status TEXT NOT NULL CHECK(status IN ('passaged','discarded','frozen')),
  at TEXT NOT NULL,
  log_id TEXT NOT NULL REFERENCES culture_logs(id) ON DELETE CASCADE,
  PRIMARY KEY(culture_id, plate_no));`;

function allowFrozenPlates(database: DatabaseSync): void {
  const table = database.prepare("SELECT sql FROM sqlite_schema WHERE name='culture_plates'").get();
  if (!table || String(table.sql).includes("'frozen'")) return;
  database.exec('BEGIN');
  try {
    database.exec(`ALTER TABLE culture_plates RENAME TO culture_plates_old;
      ${culturePlatesDdl}
      INSERT INTO culture_plates(culture_id,plate_no,status,at,log_id)
        SELECT culture_id,plate_no,status,at,log_id FROM culture_plates_old;
      DROP TABLE culture_plates_old;`);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

db.exec(`
PRAGMA busy_timeout=5000;
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, subject_id TEXT, kind TEXT NOT NULL, status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0, message TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_subject ON jobs(subject_id, kind, created_at);
CREATE TABLE IF NOT EXISTS catalog_options(id TEXT PRIMARY KEY, category TEXT NOT NULL, label TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, UNIQUE(category, label COLLATE NOCASE));
CREATE TABLE IF NOT EXISTS protocols(id TEXT PRIMARY KEY, title TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('culture_sop','western','bradford','protein','other')),
  version TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('draft','confirmed')),
  body_md TEXT NOT NULL, source_file TEXT, builtin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS protocol_revisions(id TEXT PRIMARY KEY, protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  version TEXT NOT NULL, body_md TEXT NOT NULL, saved_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cell_lines(id TEXT PRIMARY KEY, name TEXT NOT NULL, cellosaurus_ac TEXT, synonyms TEXT NOT NULL DEFAULT '[]',
  species TEXT, tissue TEXT, disease TEXT, category TEXT, sex TEXT,
  growth_mode TEXT NOT NULL DEFAULT 'adherent' CHECK(growth_mode IN ('adherent','suspension','mixed')),
  source_bank TEXT, catalog_no TEXT, provider_url TEXT, providers TEXT NOT NULL DEFAULT '[]', doubling_time TEXT, caution TEXT,
  biosafety TEXT, max_passage INTEGER, tags TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '',
  sop_protocol_id TEXT REFERENCES protocols(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS protocol_copies(
  protocol_id TEXT PRIMARY KEY REFERENCES protocols(id) ON DELETE CASCADE,
  source_protocol_id TEXT NOT NULL, source_title TEXT NOT NULL, source_version TEXT NOT NULL,
  source_provenance TEXT NOT NULL,
  cell_line_id TEXT REFERENCES cell_lines(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS culture_profiles(id TEXT PRIMARY KEY, cell_line_id TEXT NOT NULL REFERENCES cell_lines(id) ON DELETE CASCADE,
  name TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('manual','literature','provider')), fields TEXT NOT NULL,
  source_refs TEXT NOT NULL DEFAULT '[]', is_active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cryo_lots(id TEXT PRIMARY KEY, cell_line_id TEXT NOT NULL REFERENCES cell_lines(id) ON DELETE CASCADE,
  source_culture_id TEXT REFERENCES cultures(id) ON DELETE SET NULL, origin TEXT NOT NULL CHECK(origin IN ('received','frozen')),
  label TEXT NOT NULL, passage INTEGER, vials_initial INTEGER NOT NULL CHECK(vials_initial >= 1),
  vials_remaining INTEGER NOT NULL CHECK(vials_remaining >= 0), cells_per_vial REAL, freezing_medium TEXT,
  location TEXT NOT NULL DEFAULT '', supplier_lot TEXT, event_at TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cultures(id TEXT PRIMARY KEY, cell_line_id TEXT NOT NULL REFERENCES cell_lines(id) ON DELETE CASCADE,
  parent_culture_id TEXT REFERENCES cultures(id) ON DELETE SET NULL, parent_lot_id TEXT REFERENCES cryo_lots(id) ON DELETE SET NULL,
  profile_id TEXT REFERENCES culture_profiles(id) ON DELETE SET NULL, label TEXT NOT NULL, passage INTEGER NOT NULL, vessel TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','split','frozen','harvested','discarded','contaminated')),
  started_at TEXT NOT NULL, ended_at TEXT, end_note TEXT, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS culture_logs(id TEXT PRIMARY KEY, culture_id TEXT NOT NULL REFERENCES cultures(id) ON DELETE CASCADE,
  at TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('observation','medium_change','passage','freeze','harvest','treatment','mycoplasma','note')),
  confluency_pct REAL, cells_per_ml REAL, viability_pct REAL, total_cells REAL,
  mycoplasma TEXT CHECK(mycoplasma IN ('negative','positive','pending')), extra TEXT NOT NULL DEFAULT '{}',
  note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS culture_logs_culture ON culture_logs(culture_id, at);
CREATE TABLE IF NOT EXISTS literature_reports(id TEXT PRIMARY KEY, cell_line_id TEXT NOT NULL REFERENCES cell_lines(id) ON DELETE CASCADE,
  content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bradford_assays(id TEXT PRIMARY KEY, title TEXT NOT NULL, performed_at TEXT NOT NULL, data TEXT NOT NULL,
  protocol_id TEXT REFERENCES protocols(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS western_runs(id TEXT PRIMARY KEY, title TEXT NOT NULL, performed_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('planned','in_progress','done')),
  protocol_id TEXT REFERENCES protocols(id) ON DELETE SET NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lab_vessel_products(id TEXT PRIMARY KEY, label TEXT NOT NULL, format TEXT NOT NULL,
  manufacturer TEXT NOT NULL DEFAULT '', catalog_no TEXT NOT NULL DEFAULT '',
  surface_treatment TEXT NOT NULL DEFAULT 'unknown' CHECK(surface_treatment IN ('treated','untreated','unknown')),
  wells_per_unit INTEGER NOT NULL DEFAULT 1 CHECK(wells_per_unit >= 1), area_cm2_per_well REAL,
  medium_min_ml_per_well REAL, medium_max_ml_per_well REAL,
  spec_status TEXT NOT NULL DEFAULT 'reference' CHECK(spec_status IN ('reference','product_confirmed')),
  source_label TEXT NOT NULL DEFAULT '', url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
${mediumProductsDdl('lab_medium_products')}
CREATE INDEX IF NOT EXISTS lab_medium_products_kind ON lab_medium_products(kind, label);
`);
db.exec(CULTURE_OPERATION_DDL);
db.exec(`
CREATE TABLE IF NOT EXISTS cell_protocols(
  protocol_id TEXT PRIMARY KEY REFERENCES protocols(id) ON DELETE CASCADE,
  cell_line_id TEXT NOT NULL REFERENCES cell_lines(id) ON DELETE CASCADE,
  folder TEXT NOT NULL CHECK(folder IN ('general','thaw','feed','passage','freeze','treatment')),
  sort INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS cell_protocols_line ON cell_protocols(cell_line_id, folder, sort);
CREATE TABLE IF NOT EXISTS culture_log_protocols(
  log_id TEXT PRIMARY KEY REFERENCES culture_logs(id) ON DELETE CASCADE,
  protocol_id TEXT REFERENCES protocols(id) ON DELETE SET NULL,
  title TEXT NOT NULL, version TEXT NOT NULL, protocol_updated_at TEXT NOT NULL,
  steps TEXT NOT NULL, created_at TEXT NOT NULL);
-- A vessel without a row is still active. Undoing its operation deletes the row by cascade.
${culturePlatesDdl}
-- Earlier per-line SOP copies become that line's general protocols.
INSERT OR IGNORE INTO cell_protocols(protocol_id,cell_line_id,folder,sort)
  SELECT protocol_id,cell_line_id,'general',0 FROM protocol_copies
  WHERE cell_line_id IS NOT NULL AND cell_line_id IN (SELECT id FROM cell_lines);
`);
allowFrozenPlates(db);
// Cultures ended by hand before the end became a record get that record, so every end can be edited or undone from it.
// A culture discarded plate by plate already has its plate-discard record.
db.exec(`INSERT INTO culture_logs(id,culture_id,at,type,extra,note,created_at)
  SELECT lower(hex(randomblob(6))), c.id, c.ended_at, CASE c.status WHEN 'harvested' THEN 'harvest' ELSE 'note' END,
    json_object('endStatus', c.status), COALESCE(c.end_note, ''), c.ended_at
  FROM cultures c
  WHERE c.status IN ('harvested','discarded','contaminated') AND c.ended_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM culture_logs l WHERE l.culture_id=c.id AND json_extract(l.extra,'$.endStatus') IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM culture_plates p WHERE p.culture_id=c.id AND p.status='discarded' AND p.at=c.ended_at);`);

db.prepare(`UPDATE jobs SET status='error', error='서버 재시작으로 중단', updated_at=? WHERE status IN ('queued','running')`).run(
  new Date().toISOString(),
);

// Additive migration: existing profiles retain their original fields and sources.
export function migrateCultureProfiles(database: DatabaseSync): void {
  if (!(database.prepare('PRAGMA table_info(culture_profiles)').all() as { name: string }[]).some((column) => column.name === 'execution_plan')) {
    database.exec('ALTER TABLE culture_profiles ADD COLUMN execution_plan TEXT');
  }
}
migrateCultureProfiles(db);

/** Lab medium/reagent products; `strength_x` is the supplied strength of a freezing medium (1 = 1X, 2 = 2X). */
function mediumProductsDdl(table: string): string {
  return `CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('base_medium','serum','antibiotic','supplement','freezing_medium','other')), label TEXT NOT NULL,
  manufacturer TEXT NOT NULL DEFAULT '', catalog_no TEXT NOT NULL DEFAULT '', lot_no TEXT NOT NULL DEFAULT '',
  ingredients TEXT NOT NULL DEFAULT '[]', ingredients_confirmed INTEGER NOT NULL DEFAULT 0, strength_x REAL,
  source_label TEXT NOT NULL DEFAULT '', url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`;
}

/**
 * Additive migration for freezing stocks: the line's stock concentration, and freezing medium as a product kind with
 * its strength (1X/2X). SQLite cannot widen a CHECK, so the product table is rebuilt once, keeping every row.
 */
export function migrateFreezingStock(database: DatabaseSync): void {
  if (!(database.prepare('PRAGMA table_info(cell_lines)').all() as { name: string }[]).some((column) => column.name === 'stock_cells_per_ml')) {
    database.exec('ALTER TABLE cell_lines ADD COLUMN stock_cells_per_ml REAL');
  }
  if (!(database.prepare('PRAGMA table_info(cell_lines)').all() as { name: string }[]).some((column) => column.name === 'passage_cells_per_cm2')) {
    database.exec('ALTER TABLE cell_lines ADD COLUMN passage_cells_per_cm2 REAL');
  }
  const table = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='lab_medium_products'").get() as { sql: string };
  if (table.sql.includes('freezing_medium')) return;
  const columns = 'id,kind,label,manufacturer,catalog_no,lot_no,ingredients,ingredients_confirmed,source_label,url,created_at,updated_at';
  database.exec('BEGIN');
  try {
    database.exec(`${mediumProductsDdl('lab_medium_products_new')}
INSERT INTO lab_medium_products_new(${columns}) SELECT ${columns} FROM lab_medium_products;
DROP TABLE lab_medium_products;
ALTER TABLE lab_medium_products_new RENAME TO lab_medium_products;
CREATE INDEX IF NOT EXISTS lab_medium_products_kind ON lab_medium_products(kind, label);`);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
migrateFreezingStock(db);

/**
 * Link thaw/passage/freeze records written before records carried links to what they made, and give every thawed culture
 * its thaw record back (earlier versions let it be deleted on its own). Linked records are skipped, so this is idempotent.
 */
export function linkOperationRecords(database: DatabaseSync): void {
  type Row = { id: string; culture_id: string; at: string; note: string; extra: string };
  const extraOf = (row: Row) => parseJsonColumn<Record<string, string>>(row.extra, {});
  const setExtra = database.prepare('UPDATE culture_logs SET extra=? WHERE id=?');
  database.exec('BEGIN');
  try {
    const thawed = database
      .prepare('SELECT c.id,c.parent_lot_id,c.started_at,c.created_at,l.label FROM cultures c JOIN cryo_lots l ON l.id=c.parent_lot_id')
      .all() as { id: string; parent_lot_id: string; started_at: string; created_at: string; label: string }[];
    for (const culture of thawed) {
      const notes = database.prepare("SELECT * FROM culture_logs WHERE culture_id=? AND type='note' ORDER BY at,created_at,id").all(culture.id) as Row[];
      if (notes.some((n) => extraOf(n).thawLotId)) continue;
      const legacy = notes.find((n) => n.note.startsWith('해동 ('));
      if (legacy) {
        const vials = /, (\d+) vial\)/.exec(legacy.note)?.[1];
        setExtra.run(JSON.stringify({ ...extraOf(legacy), thawLotId: culture.parent_lot_id, ...(vials ? { thawVials: vials } : {}) }), legacy.id);
      } else {
        database
          .prepare("INSERT INTO culture_logs(id,culture_id,at,type,extra,note,created_at) VALUES(?,?,?,'note',?,?,?)")
          .run(nanoid(12), culture.id, culture.started_at, JSON.stringify({ thawLotId: culture.parent_lot_id }), `해동 (${culture.label})`, culture.created_at);
      }
    }
    const claimed = new Set<string>();
    for (const row of database.prepare("SELECT * FROM culture_logs WHERE type='passage' ORDER BY at,created_at,id").all() as Row[]) {
      const extra = extraOf(row);
      if (extra.childCultureIds !== undefined) continue;
      const ids = (database.prepare('SELECT id FROM cultures WHERE parent_culture_id=? AND started_at=? ORDER BY created_at,id').all(row.culture_id, row.at) as { id: string }[])
        .map((c) => c.id)
        .filter((id) => !claimed.has(id));
      for (const id of ids) claimed.add(id);
      setExtra.run(JSON.stringify({ ...extra, childCultureIds: ids.join(',') }), row.id);
    }
    for (const row of database.prepare("SELECT * FROM culture_logs WHERE type='freeze' ORDER BY at,created_at,id").all() as Row[]) {
      const extra = extraOf(row);
      if (extra.frozenLotId !== undefined) continue;
      const lot = (database.prepare("SELECT id FROM cryo_lots WHERE source_culture_id=? AND event_at=? AND origin='frozen' ORDER BY created_at,id").all(row.culture_id, row.at) as { id: string }[]).find(
        (l) => !claimed.has(l.id),
      );
      if (lot) claimed.add(lot.id);
      setExtra.run(JSON.stringify({ ...extra, frozenLotId: lot?.id ?? '' }), row.id);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
linkOperationRecords(db);

export const now = () => new Date().toISOString();

/** Run fn inside BEGIN/COMMIT, rolling back on throw. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Parse a JSON TEXT column, falling back when the stored value is unreadable. */
export function parseJsonColumn<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

seedBuiltins(db);
