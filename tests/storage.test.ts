import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultDataDir, resolveStoragePaths } from '../src/shared/storage';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'cell-lab-storage-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe('per-user storage', () => {
  it('keeps attached files inside the data folder by default', () => {
    const paths = resolveStoragePaths({ home, env: {}, platform: 'darwin' });
    expect(paths).toEqual({
      dbDir: join(home, 'Library', 'Application Support', 'cell-lab'),
      files: join(home, 'Library', 'Application Support', 'cell-lab', 'files'),
    });
  });

  it('honors explicit storage overrides with ~ expansion', () => {
    const result = resolveStoragePaths({ home, env: { CELL_LAB_DB_DIR: '~/custom-db', CELL_LAB_FILES: '~/custom-files' } });
    expect(result).toEqual({ dbDir: join(home, 'custom-db'), files: join(home, 'custom-files') });
  });
});

it('keeps Windows data under %APPDATA% and macOS data under Application Support', () => {
  expect(defaultDataDir({ home: 'C:\\Users\\me', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, platform: 'win32' })).toBe(
    join('C:\\Users\\me\\AppData\\Roaming', 'cell-lab'),
  );
  expect(defaultDataDir({ home: '/Users/me', env: {}, platform: 'darwin' })).toBe(join('/Users/me', 'Library', 'Application Support', 'cell-lab'));
});
