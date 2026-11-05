import { readFile, writeFile } from 'node:fs/promises';
import { docxToMarkdown } from '../src/server/protocol-import';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('사용법: npx tsx scripts/convert-docx.ts <입력.docx> <출력.md>');
  process.exitCode = 1;
} else {
  await writeFile(output, await docxToMarkdown(await readFile(input)), 'utf8');
  console.log(`마크다운 저장: ${output}`);
}
