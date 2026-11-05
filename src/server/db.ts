import { DatabaseSync } from 'node:sqlite';
import { PATHS } from './config';
import { seedBuiltins } from './seed';

export const db = new DatabaseSync(PATHS.db);

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
`);

db.prepare(`UPDATE jobs SET status='error', error='서버 재시작으로 중단', updated_at=? WHERE status IN ('queued','running')`).run(
  new Date().toISOString(),
);

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
