import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';
import type { CultureDto, LotDto } from '../src/shared/cell-line';
vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
import { createApp } from '../src/server/app';
import { db, now } from '../src/server/db';

const app = createApp();
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
// Local wall-clock times: the notebook groups days in the server's timezone.
const local = (month: number, day: number, hour = 9, minute = 0) => new Date(2026, month - 1, day, hour, minute).toISOString();
const get = (query = '') => app.request(`/api/cell-lines/tcmk/notebook${query}`);
let first: CultureDto;
let second: CultureDto;
let protocolUpdatedAt: string;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await app.request(path, json('POST', body));
  expect(res.status).toBeLessThan(300);
  return (await res.json()) as T;
}

beforeAll(async () => {
  db.prepare('INSERT INTO cell_lines(id,name,species,source_bank,catalog_no,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(
    'tcmk',
    'TCMK-1',
    'Canis lupus',
    'ATCC',
    'CCL-139',
    now(),
    now(),
  );
  protocolUpdatedAt = now();
  db.prepare('INSERT INTO protocols(id,title,category,version,status,body_md,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(
    'feed-sop',
    'TCMK-1 배지 교체',
    'culture_sop',
    'v1',
    'confirmed',
    '# 배지 교체\n\n1. 기존 배지를 완전히 제거한다\n2. 새 배지를 넣는다\n',
    now(),
    protocolUpdatedAt,
  );
  db.prepare('INSERT INTO cell_protocols(protocol_id,cell_line_id,folder,sort) VALUES(?,?,?,?)').run('feed-sop', 'tcmk', 'feed', 0);

  const lot = await post<LotDto>('/api/cell-lines/tcmk/lots', { passage: 5, vials: 3, receivedAt: local(11, 1), location: 'LN2 A-1' });
  first = (await post<{ culture: CultureDto }>(`/api/lots/${lot.id}/thaw`, { vessel: 'T25', at: local(11, 2) })).culture;
  second = (await post<{ culture: CultureDto }>(`/api/lots/${lot.id}/thaw`, { vessel: 'T25', at: local(11, 5) })).culture;
  await post(`/api/cultures/${first.id}/logs`, {
    type: 'observation',
    at: local(11, 10, 10, 0),
    confluencyPct: 70,
    morphology: '방추형',
    note: '상태 양호\n\n[사용 조건 스냅샷 · 테스트]\n조건 세트: 기본',
  });
  await post(`/api/cultures/${first.id}/logs`, {
    type: 'medium_change',
    at: local(11, 3, 14, 30),
    feed: { mode: 'partial', removedMl: 2, addedMl: 5, mediumLabel: 'DMEM + 10% FBS' },
    protocolRun: { protocolId: 'feed-sop', protocolUpdatedAt, deviations: [{ index: 0, text: '기존 배지를 절반만 제거한다' }] },
  });
  await post(`/api/cultures/${second.id}/logs`, { type: 'observation', at: local(11, 6, 9, 0), confluencyPct: 30, note: '두 번째 배양 관찰' });
  await post(`/api/cultures/${first.id}/end`, { at: local(11, 12, 16, 0), status: 'discarded', note: '오염 의심으로 폐기' });
});

describe('실험노트 내보내기', () => {
  it('Markdown은 날짜순 제목, 한국어 종류, 값, 사용 조건을 담는다', async () => {
    const res = await get('?format=md');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    const md = await res.text();
    expect(md).toContain('# 실험노트 — TCMK-1');
    expect(md).toContain('Canis lupus · ATCC · Cat. CCL-139');
    const headings = md.split('\n').filter((l) => l.startsWith('## '));
    expect(headings).toEqual(['## 2026-11-01 (일)', '## 2026-11-02 (월)', '## 2026-11-03 (화)', '## 2026-11-05 (목)', '## 2026-11-06 (금)', '## 2026-11-10 (화)', '## 2026-11-12 (목)']);
    expect(md).toContain('### 14:30 · TCMK-1-P5-T1 · P5 · 배지 교체');
    expect(md).toContain('### 10:00 · TCMK-1-P5-T1 · P5 · 관찰');
    expect(md).toContain('### 09:00 · TCMK-1-P5-T1 · P5 · 해동');
    expect(md).toContain('Confluency 70%');
    expect(md).toContain('부분 교환 · DMEM + 10% FBS · 제거 2 mL / 추가 5 mL');
    expect(md).toContain('형태: 방추형');
    expect(md).toContain('상태 양호');
    expect(md).toContain('> **사용 조건**');
    expect(md).toContain('조건 세트: 기본');
    expect(md).not.toContain('[사용 조건 스냅샷');
    expect(md).toContain('Stock 입고');
    expect(md).toContain('보관 LN2 A-1');
    expect(md).toContain('배양 종료 · TCMK-1-P5-T1 · P5');
    expect(md).toContain('상태: 폐기');
    expect(md).toContain('오염 의심으로 폐기');
  });

  it('같은 사용 조건 스냅샷은 배양별로 바뀔 때만 다시 보인다', async () => {
    const snapshot = (set: string) => `\n\n[사용 조건 스냅샷 · 테스트]\n조건 세트: ${set}`;
    for (const [hour, set] of [[10, '세트 A'], [11, '세트 A'], [12, '세트 B']] as const)
      await post(`/api/cultures/${second.id}/logs`, { type: 'observation', at: local(11, 6, hour, 0), note: `메모 ${hour}${snapshot(set)}` });
    const md = await (await get(`?format=md&cultureId=${second.id}`)).text();
    expect(md.match(/> \*\*사용 조건\*\*/g)).toHaveLength(2);
    expect(md.match(/조건 세트: 세트 A/g)).toHaveLength(1);
    expect(md.match(/조건 세트: 세트 B/g)).toHaveLength(1);
    expect(md).toContain('메모 11');
  });

  it('변경한 프로토콜 단계는 원문에 취소선을 긋고 수행한 방법을 보인다', async () => {
    const md = await (await get('?format=md')).text();
    expect(md).toContain('~~기존 배지를 완전히 제거한다~~ → **기존 배지를 절반만 제거한다**');
    expect(md).toContain('2. 새 배지를 넣는다');
  });

  it('기간 필터는 양 끝 날짜를 포함하고 밖의 날은 제외한다', async () => {
    const md = await (await get('?format=md&from=2026-11-03&to=2026-11-06')).text();
    const headings = md.split('\n').filter((l) => l.startsWith('## '));
    expect(headings).toEqual(['## 2026-11-03 (화)', '## 2026-11-05 (목)', '## 2026-11-06 (금)']);
    expect(md).toContain('기간: 2026-11-03 ~ 2026-11-06');
    expect(md).not.toContain('Confluency 70%');
  });

  it('기록이 없는 기간은 안내 문장을 보인다', async () => {
    const md = await (await get('?format=md&from=2025-01-01&to=2025-01-31')).text();
    expect(md).toContain('이 기간에 기록이 없습니다.');
    expect(md).not.toContain('## ');
  });

  it('배양 필터는 그 배양의 기록만 담는다', async () => {
    const md = await (await get(`?format=md&cultureId=${second.id}`)).text();
    expect(md).toContain('배양: TCMK-1-P5-T2');
    expect(md).toContain('두 번째 배양 관찰');
    expect(md).not.toContain('Confluency 70%');
    expect(md).not.toContain('배양 종료');
    expect((await get('?cultureId=nope')).status).toBe(404);
  });

  it('HTML은 취소선 <del>과 첨부 파일 이름을 가진다', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toContain("attachment; ");
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent('TCMK-1_실험노트_')}`);
    const html = await res.text();
    expect(html).toContain('<del>기존 배지를 완전히 제거한다</del>');
    expect(html).toContain('<h2>2026-11-03 (화)</h2>');
    expect(html).toContain('@page');
    const range = await get('?format=md&from=2026-11-01&to=2026-11-16');
    expect(decodeURIComponent((range.headers.get('content-disposition') ?? '').split("UTF-8''")[1])).toBe('TCMK-1_실험노트_2026-11-01_2026-11-16.md');
  });

  it('잘못된 날짜·형식은 400, 없는 세포주는 404이다', async () => {
    for (const query of ['?from=2026-13-01', '?to=11/05/2026', '?from=2026-02-30', '?from=2026-11-10&to=2026-11-01', '?format=pdf']) {
      expect((await get(query)).status, query).toBe(400);
    }
    expect((await app.request('/api/cell-lines/none/notebook')).status).toBe(404);
  });
});
