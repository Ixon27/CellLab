import { CULTURE_FIELDS, completeMediumText } from './culture';
import type { CultureProfileFields } from './culture';

export function fillSop(template: string, line: { name: string; max_passage: number | null }, fields: CultureProfileFields): string {
  const values = new Map<string, { label: string; value: unknown }>(CULTURE_FIELDS.map((field) => [field.key, { label: field.label, value: fields[field.key] }]));
  values.set('complete_medium', { label: '완전 배지', value: completeMediumText(fields) });
  values.set('cell_line', { label: '세포주', value: line.name });
  values.set('max_passage', { label: '최대 passage', value: line.max_passage });
  return template.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (placeholder, key: string) => {
    const item = values.get(key);
    if (!item) return placeholder;
    const text = Array.isArray(item.value) ? item.value.join(', ') : item.value === null || item.value === undefined ? '' : String(item.value);
    return text.trim() || `**(미정: ${item.label})**`;
  });
}
