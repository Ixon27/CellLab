import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAppIcon } from './build-app-icon.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(join(root, 'dist/index.html'))) throw new Error('웹 빌드가 없습니다. 먼저 npm run build를 실행하세요.');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const output = join(root, 'build-desktop');
const staged = join(output, 'app');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const common = {
  absWorkingDir: root, bundle: true, platform: 'node', target: 'node24',
  sourcemap: false, legalComments: 'eof', logLevel: 'info',
};
const esm = {
  ...common, format: 'esm', external: ['electron'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
};
await Promise.all([
  build({ ...esm, entryPoints: ['src/desktop/main.ts'], outfile: join(output, 'main.mjs') }),
  build({ ...esm, entryPoints: ['src/desktop/backend.ts'], outfile: join(output, 'backend.mjs') }),
  build({ ...common, format: 'cjs', external: ['electron'], entryPoints: ['src/desktop/preload.ts'], outfile: join(output, 'preload.cjs') }),
]);
await buildAppIcon();

// Everything the backend needs is bundled, so the staged app ships no node_modules.
// A separate, minimal manifest keeps the developer's dependencies out of the package.
mkdirSync(join(staged, 'build-desktop'), { recursive: true });
for (const file of ['main.mjs', 'backend.mjs', 'preload.cjs']) cpSync(join(output, file), join(staged, 'build-desktop', file));
for (const directory of ['dist', 'prompts', 'seed']) cpSync(join(root, directory), join(staged, directory), { recursive: true, dereference: true });
if (existsSync(join(root, 'LICENSE'))) cpSync(join(root, 'LICENSE'), join(staged, 'LICENSE'));

writeFileSync(join(staged, 'package.json'), JSON.stringify({
  name: manifest.name, version: manifest.version, productName: manifest.productName,
  description: manifest.description, author: manifest.author, license: manifest.license,
  type: 'module', main: 'build-desktop/main.mjs',
}, null, 2) + '\n');
console.log(`데스크톱 빌드 준비 완료 (${process.arch}): ${staged}`);
