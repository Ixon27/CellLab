import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StoragePaths {
  dbDir: string;
  files: string;
}

/** The per-user data folder the app uses when nothing overrides it. */
export function defaultDataDir({ env = process.env, home = homedir(), platform = process.platform }: {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
} = {}): string {
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'cell-lab');
  return join(home, 'Library', 'Application Support', 'cell-lab');
}

/** Per-user storage; environment variables override the defaults (tests, portable setups). */
export function resolveStoragePaths({ env = process.env, home = homedir(), userData, platform = process.platform }: {
  env?: NodeJS.ProcessEnv;
  home?: string;
  userData?: string;
  platform?: NodeJS.Platform;
} = {}): StoragePaths {
  const expand = (value: string) => value === '~' || value.startsWith('~/') ? join(home, value.slice(1)) : value;
  const dbDir = expand(env.CELL_LAB_DB_DIR || env.CELL_LAB_USER_DATA || userData || defaultDataDir({ env, home, platform }));
  return { dbDir, files: expand(env.CELL_LAB_FILES || join(dbDir, 'files')) };
}
