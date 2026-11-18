import {
  buildProtocolRun,
  protocolSteps,
  reviseProtocolRun,
  validateProtocolRunEdit,
  validateProtocolRunInput,
} from '../shared/protocol-run';
import type { ProtocolRun } from '../shared/protocol-run';
import type { CultureProfileFields } from '../shared/culture';
import { previewSop } from '../shared/sop';
import type { ProfileRow } from './cell-lines';
import { activeProfileRow, getLineRow } from './cell-lines';
import { db, now, parseJsonColumn } from './db';
import { HttpError } from './http-error';

/**
 * Store the protocol a record followed, as shown to the user: the protocol filled with the culture's linked
 * condition set (else the active one), then this run's step changes. The protocol itself is never modified.
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
  const protocol = db.prepare('SELECT id,title,version,body_md,updated_at FROM protocols WHERE id=?').get(input.protocolId) as
    | { id: string; title: string; version: string; body_md: string; updated_at: string }
    | undefined;
  if (!protocol) throw new HttpError(400, '선택한 프로토콜을 찾을 수 없습니다');
  if (protocol.updated_at !== input.protocolUpdatedAt)
    throw new HttpError(409, '그 사이 프로토콜이 수정되었습니다. 프로토콜을 다시 불러온 뒤 저장하세요');
  const culture = db.prepare('SELECT cell_line_id,profile_id FROM cultures WHERE id=?').get(cultureId) as
    | { cell_line_id: string; profile_id: string | null }
    | undefined;
  if (!culture) throw new HttpError(404, '배양을 찾을 수 없습니다');
  const line = getLineRow(culture.cell_line_id);
  const profile =
    (culture.profile_id ? (db.prepare('SELECT * FROM culture_profiles WHERE id=?').get(culture.profile_id) as ProfileRow | undefined) : undefined) ??
    activeProfileRow(line.id);
  const filled = previewSop(protocol.body_md, line, parseJsonColumn<CultureProfileFields>(profile?.fields, {})).markdown;
  let run;
  try {
    run = buildProtocolRun({ id: protocol.id, title: protocol.title, version: protocol.version, updatedAt: protocol.updated_at }, protocolSteps(filled), input.deviations);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const insert = db.prepare(
    'INSERT INTO culture_log_protocols(log_id,protocol_id,title,version,protocol_updated_at,steps,created_at) VALUES(?,?,?,?,?,?,?)',
  );
  const steps = JSON.stringify(run.steps);
  for (const logId of logIds) insert.run(logId, protocol.id, run.title, run.version, run.protocolUpdatedAt, steps, now());
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
