import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Server modules create their data dirs on import; keep tests away from the real ones.
const scratch = join(tmpdir(), 'cell-lab-test');

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: {
      CELL_LAB_DB_DIR: join(scratch, 'db'),
      CELL_LAB_FILES: join(scratch, 'files'),
    },
  },
});
