import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { nanoid } from 'nanoid';
import { PHOTO_MAX_BYTES, PHOTO_MAX_PER_LOG, sniffImage } from '../shared/culture-operations';
import type { PhotoDto } from '../shared/culture-operations';
import type { PhotoRow } from './cell-lines';
import { toPhotoDto } from './cell-lines';
import { PATHS } from './config';
import { db, now, tx } from './db';
import { HttpError } from './http-error';

/** Observation photos are user assets under the app's file store; they are removed with their record. */
export const PHOTO_DIR = join(PATHS.files, 'culture-photos');
// Names are generated here (never taken from the client), so anything else is refused outright.
const STORED_NAME = /^[A-Za-z0-9_-]{16,40}\.(png|jpg)$/;

/** Absolute path of a stored photo, confined to PHOTO_DIR. */
export function photoPath(fileName: string): string {
  const dir = resolve(PHOTO_DIR);
  const path = resolve(dir, fileName);
  if (!STORED_NAME.test(fileName) || basename(path) !== fileName || !path.startsWith(dir + sep)) throw new HttpError(404, '사진을 찾을 수 없습니다');
  return path;
}

/** Best-effort unlink; a missing file must never block deleting its record. */
export function removePhotoFiles(fileNames: string[]): void {
  for (const name of fileNames) {
    try {
      rmSync(photoPath(name), { force: true });
    } catch {
      /* already gone or unsafe name */
    }
  }
}

export function photoFilesForLine(lineId: string): string[] {
  return (
    db
      .prepare(
        'SELECT p.file_name AS name FROM culture_log_photos p JOIN culture_logs l ON l.id=p.log_id JOIN cultures c ON c.id=l.culture_id WHERE c.cell_line_id=?',
      )
      .all(lineId) as { name: string }[]
  ).map((r) => r.name);
}

export function photoFilesForLog(logId: string): string[] {
  return (db.prepare('SELECT file_name AS name FROM culture_log_photos WHERE log_id=?').all(logId) as { name: string }[]).map((r) => r.name);
}

export function getPhotoRow(id: string): PhotoRow {
  const row = db.prepare('SELECT * FROM culture_log_photos WHERE id=?').get(id) as PhotoRow | undefined;
  if (!row) throw new HttpError(404, '사진을 찾을 수 없습니다');
  return row;
}

function displayName(raw: string): string {
  // Display only: the stored file name is generated.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are stripped on purpose
  const cleaned = basename(raw.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'photo').slice(0, 120);
}

/** True when the PNG has a real header chunk (blocks files that only start with the 8 signature bytes). */
function pngHasHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 33 && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR';
}

/** Validate size, declared type, magic bytes and structure, then store the file and its row. */
export async function savePhoto(logId: string, file: File): Promise<PhotoDto> {
  const log = db.prepare('SELECT type FROM culture_logs WHERE id=?').get(logId) as { type: string } | undefined;
  if (!log) throw new HttpError(404, '기록을 찾을 수 없습니다');
  if (log.type !== 'observation') throw new HttpError(400, '사진은 관찰 기록에만 첨부할 수 있습니다');
  if (file.size === 0) throw new HttpError(400, '빈 파일입니다');
  if (file.size > PHOTO_MAX_BYTES) throw new HttpError(400, `사진은 ${PHOTO_MAX_BYTES / 1024 / 1024} MB 이하여야 합니다`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > PHOTO_MAX_BYTES) throw new HttpError(400, `사진은 ${PHOTO_MAX_BYTES / 1024 / 1024} MB 이하여야 합니다`);
  const mime = sniffImage(bytes);
  if (!mime || (mime === 'image/png' && !pngHasHeader(bytes))) throw new HttpError(400, 'PNG 또는 JPEG 사진만 첨부할 수 있습니다');
  if (file.type !== mime) throw new HttpError(400, '파일 형식과 내용이 일치하지 않습니다');
  const id = nanoid(12);
  const fileName = `${nanoid(24)}.${mime === 'image/png' ? 'png' : 'jpg'}`;
  mkdirSync(PHOTO_DIR, { recursive: true });
  const path = photoPath(fileName);
  writeFileSync(path, bytes, { flag: 'wx' });
  try {
    return tx(() => {
      const count = db.prepare('SELECT COUNT(*) AS n FROM culture_log_photos WHERE log_id=?').get(logId) as { n: number };
      if (count.n >= PHOTO_MAX_PER_LOG) throw new HttpError(400, `기록당 사진은 최대 ${PHOTO_MAX_PER_LOG}장입니다`);
      db.prepare('INSERT INTO culture_log_photos(id,log_id,file_name,original_name,mime,bytes,created_at) VALUES(?,?,?,?,?,?,?)').run(
        id,
        logId,
        fileName,
        displayName(file.name),
        mime,
        bytes.length,
        now(),
      );
      return toPhotoDto(getPhotoRow(id));
    });
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  }
}

export function readPhoto(row: PhotoRow): Buffer {
  try {
    return readFileSync(photoPath(row.file_name));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(404, '사진 파일을 찾을 수 없습니다');
  }
}
