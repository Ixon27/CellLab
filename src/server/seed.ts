import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BUILTIN_OPTIONS, CATALOG_CATEGORIES } from '../shared/catalog';
import { PATHS } from './config';

export const BUILTIN_PROTOCOLS = [
  { id: 'western-blot-v1-1', title: 'Western blot 프로토콜 (재료·주의사항 포함) v1.1', category: 'western', version: 'v1.1' },
  { id: 'western-lab-notes', title: 'Western blotting (실험실 노트)', category: 'western', version: '실험실 노트' },
  { id: 'sop-adherent', title: '부착 세포 배양 SOP', category: 'culture_sop', version: 'v1' },
  { id: 'sop-suspension', title: '부유 세포 배양 SOP', category: 'culture_sop', version: 'v1' },
] as const;

/** Insert built-in catalog options and protocols; rows the user already has (or edited) are left alone. */
export function seedBuiltins(d: DatabaseSync): void {
  const t = new Date().toISOString();
  const option = d.prepare('INSERT OR IGNORE INTO catalog_options(id,category,label,builtin,hidden,sort,created_at) VALUES(?,?,?,1,0,?,?)');
  for (const category of CATALOG_CATEGORIES) {
    BUILTIN_OPTIONS[category].forEach((label, i) => option.run(`builtin:${category}:${i}`, category, label, i, t));
  }
  const protocol = d.prepare(
    `INSERT OR IGNORE INTO protocols(id,title,category,version,status,body_md,source_file,builtin,created_at,updated_at)
     VALUES(?,?,?,?,'draft',?,NULL,1,?,?)`,
  );
  for (const p of BUILTIN_PROTOCOLS) {
    const file = join(PATHS.seed, 'protocols', `${p.id}.md`);
    if (!existsSync(file)) continue;
    protocol.run(p.id, p.title, p.category, p.version, readFileSync(file, 'utf8'), t, t);
  }
}
