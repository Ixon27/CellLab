import { nanoid } from 'nanoid';
import type { CatalogCategory, CatalogOption } from '../shared/catalog';
import { db, now } from './db';

export interface CatalogRow {
  id: string;
  category: CatalogCategory;
  label: string;
  builtin: number;
  hidden: number;
  sort: number;
  created_at: string;
}

export function toOption(row: CatalogRow): CatalogOption {
  return { id: row.id, category: row.category, label: row.label, builtin: row.builtin === 1, hidden: row.hidden === 1 };
}

/** The existing option with this label (case-insensitive), if any. */
export function findOption(category: CatalogCategory, label: string): CatalogRow | undefined {
  return db.prepare('SELECT * FROM catalog_options WHERE category=? AND label=? COLLATE NOCASE').get(category, label) as CatalogRow | undefined;
}

/** Add user options for labels not yet in the category (case-insensitive); blank labels are skipped. */
export function ensureOptions(category: CatalogCategory, labels: string[]): void {
  const insert = db.prepare('INSERT OR IGNORE INTO catalog_options(id,category,label,builtin,hidden,sort,created_at) VALUES(?,?,?,0,0,0,?)');
  for (const raw of labels) {
    const label = raw.trim();
    if (label && label.length <= 120) insert.run(nanoid(12), category, label, now());
  }
}
