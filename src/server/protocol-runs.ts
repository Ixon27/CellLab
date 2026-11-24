import { childCultureIds } from '../shared/culture-operations';
import {
  buildProtocolRun,
  protocolSteps,
  reviseProtocolRun,
  validateProtocolRunEdit,
  validateProtocolRunInput,
} from '../shared/protocol-run';
import type { ProtocolRun, ProtocolRunInput } from '../shared/protocol-run';
import type { CultureProfileFields } from '../shared/culture';
import { performedFields, previewSop } from '../shared/sop';
import type { ProfileRow } from './cell-lines';
import { activeProfileRow, getLineRow } from './cell-lines';
import { db, now, parseJsonColumn } from './db';
import { HttpError } from './http-error';

interface ProtocolRow {
  id: string;
  title: string;
  version: string;
  body_md: string;
  updated_at: string;
}

/** What a saved passage/freeze record actually used: ratio, reagent, confluency, seeding density, freezing medium. */
export function performedOfLog(logId: string): CultureProfileFields {
  const row = db.prepare('SELECT type,extra,confluency_pct FROM culture_logs WHERE id=?').get(logId) as
    | { type: string; extra: string; confluency_pct: number | null }
    | undefined;
  if (!row) return {};
  const extra = parseJsonColumn<Record<string, string>>(row.extra, {});
  if (row.type === 'passage') {
    const density = db.prepare(
      "SELECT json_extract(extra,'$.seedingDensityPerCm2') AS d FROM culture_logs WHERE culture_id=? AND json_extract(extra,'$.seedingParent') IS NOT NULL",
    );
    const densities = childCultureIds(extra).flatMap((id) => (density.all(id) as { d: string | number | null }[]).map((r) => (r.d === null ? null : Number(r.d))));
    return performedFields({
      splitRatio: extra.splitRatio,
      dissociationReagent: extra.dissociationReagent,
      confluencyPct: row.confluency_pct,
      seedingDensitiesPerCm2: densities,
    });
  }
  if (row.type === 'freeze') {
    const lot = extra.frozenLotId
      ? (db.prepare('SELECT freezing_medium FROM cryo_lots WHERE id=?').get(extra.frozenLotId) as { freezing_medium: string | null } | undefined)
      : undefined;
    return performedFields({ confluencyPct: row.confluency_pct, freezingMedium: lot?.freezing_medium });
  }
  return {};
}

/**
 * The protocol as performed in one record: filled with the culture's linked condition set (else the active one), the
 * record's own values (split ratio, seeding density, reagent, …) taking the place of the set's, then this run's changes.
 */
function runForLog(protocol: ProtocolRow, logId: string, cultureId: string, deviations: ProtocolRunInput['deviations']): ProtocolRun {
  const culture = db.prepare('SELECT cell_line_id,profile_id FROM cultures WHERE id=?').get(cultureId) as
    | { cell_line_id: string; profile_id: string | null }
    | undefined;
  if (!culture) throw new HttpError(404, '배양을 찾을 수 없습니다');
  const line = getLineRow(culture.cell_line_id);
  const profile =
    (culture.profile_id ? (db.prepare('SELECT * FROM culture_profiles WHERE id=?').get(culture.profile_id) as ProfileRow | undefined) : undefined) ??
    activeProfileRow(line.id);
  const fields = { ...parseJsonColumn<CultureProfileFields>(profile?.fields, {}), ...performedOfLog(logId) };
  const filled = previewSop(protocol.body_md, line, fields).markdown;
  try {
    return buildProtocolRun({ id: protocol.id, title: protocol.title, version: protocol.version, updatedAt: protocol.updated_at }, protocolSteps(filled), deviations);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
}

/**
 * Store the protocol a record followed (see runForLog). The protocol itself is never modified.
 * Must run inside the caller's transaction, after the logs exist.
 */
export function attachProtocolRun(logIds: string[], cultureId: string, raw: unknown): void {
  let input;
  try {
    input = validateProtocolRunInput(raw);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  if (!input || !logIds.length) return;
  const protocol = db.prepare('SELECT id,title,version,body_md,updated_at FROM protocols WHERE id=?').get(input.protocolId) as ProtocolRow | undefined;
  if (!protocol) throw new HttpError(400, '선택한 프로토콜을 찾을 수 없습니다');
  if (protocol.updated_at !== input.protocolUpdatedAt)
    throw new HttpError(409, '그 사이 프로토콜이 수정되었습니다. 프로토콜을 다시 불러온 뒤 저장하세요');
  const insert = db.prepare(
    'INSERT INTO culture_log_protocols(log_id,protocol_id,title,version,protocol_updated_at,steps,created_at) VALUES(?,?,?,?,?,?,?)',
  );
  for (const logId of logIds) {
    const run = runForLog(protocol, logId, cultureId, input.deviations);
    insert.run(logId, protocol.id, run.title, run.version, run.protocolUpdatedAt, JSON.stringify(run.steps), now());
  }
}

/**
 * Change the protocol a saved record followed, at any time: `{deviations}` revises its saved run (as performed, not the
 * current protocol text), `{protocolId,…}` attaches that protocol afresh, `null` removes it. `undefined` leaves it alone.
 * Must run inside the caller's transaction.
 */
export function editProtocolRun(logId: string, cultureId: string, raw: unknown): void {
  if (raw === undefined) return;
  let edit;
  try {
    edit = validateProtocolRunEdit(raw);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  if (edit && !('protocolId' in edit)) {
    const row = db.prepare('SELECT * FROM culture_log_protocols WHERE log_id=?').get(logId) as
      | { protocol_id: string | null; title: string; version: string; protocol_updated_at: string; steps: string }
      | undefined;
    if (!row) throw new HttpError(400, '이 기록에는 수정할 프로토콜이 없습니다. 프로토콜을 먼저 선택하세요');
    const saved: ProtocolRun = {
      protocolId: row.protocol_id,
      title: row.title,
      version: row.version,
      protocolUpdatedAt: row.protocol_updated_at,
      steps: parseJsonColumn<ProtocolRun['steps']>(row.steps, []),
    };
    let revised;
    try {
      revised = reviseProtocolRun(saved, edit.deviations);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    db.prepare('UPDATE culture_log_protocols SET steps=? WHERE log_id=?').run(JSON.stringify(revised.steps), logId);
    return;
  }
  db.prepare('DELETE FROM culture_log_protocols WHERE log_id=?').run(logId);
  if (edit) attachProtocolRun([logId], cultureId, edit);
}

/**
 * After a record's values were edited (e.g. the split ratio), put the new values where the old ones were filled into
 * its saved protocol steps. Only values the run itself supplied are replaced, so the rest stays as performed. A value
 * is replaced only as a whole token (1:7 never matches inside 1:70); a confluency only where a % follows it.
 */
export function refreshPerformedValues(logId: string, before: CultureProfileFields): void {
  const after = performedOfLog(logId);
  const swaps = Object.entries(before).flatMap(([key, old]) => {
    const from = String(old ?? '');
    const to = String(after[key as keyof CultureProfileFields] ?? '');
    if (!from || !to || from === to) return [];
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tail = key === 'subculture_confluency_pct' ? '(?=\\s*%)' : '(?![\\w.:])';
    return [{ pattern: new RegExp(`(?<![\\w.:])${escaped}${tail}`, 'g'), to }];
  });
  if (!swaps.length) return;
  const row = db.prepare('SELECT steps FROM culture_log_protocols WHERE log_id=?').get(logId) as { steps: string } | undefined;
  if (!row) return;
  const steps = parseJsonColumn<ProtocolRun['steps']>(row.steps, []).map((s) => ({
    ...s,
    original: swaps.reduce((text, { pattern, to }) => text.replace(pattern, () => to), s.original),
  }));
  db.prepare('UPDATE culture_log_protocols SET steps=? WHERE log_id=?').run(JSON.stringify(steps), logId);
}
