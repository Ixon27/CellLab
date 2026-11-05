import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';
import type { LiteratureReport } from '../src/shared/literature';
import type { EpmcHit } from '../src/server/services/europepmc';
vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
vi.mock('../src/server/llm/index', () => ({ resolveModel: vi.fn(() => ({ engine: 'claude', model: 'test', effort: 'low' })), runLlm: vi.fn() }));
import { createApp } from '../src/server/app';
import { db, now } from '../src/server/db';
import { getJobRow, cancelJob } from '../src/server/jobs';
import { runLlm } from '../src/server/llm/index';
const app = createApp();
const xml = readFileSync(new URL('./fixtures/jats-min.xml', import.meta.url), 'utf8');
const lineId = 'literature-line';
const papers: EpmcHit[] = [{ pmcid: 'PMC123', pmid: '123', title: 'Cell culture study', authors: 'Park SH, Kim A', journal: 'Cells', year: 2026, cited: 0 }, { pmcid: 'PMC404', pmid: null, title: 'Unavailable study', authors: 'Kim A', journal: 'Cells', year: 2025, cited: 0 }];
const request = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  db.prepare('DELETE FROM literature_reports').run();
  db.prepare('INSERT OR IGNORE INTO cell_lines(id,name,source_bank,catalog_no,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(lineId, 'HeLa', 'KCLB', '10002', now(), now());
  vi.mocked(runLlm).mockResolvedValue({ text: JSON.stringify({ fields: { base_medium: { value: 'DMEM', evidence: ['S1-2'] }, source_stated: { value: 'KCLB No. 10002', evidence: ['S1-1'] } } }), by: { engine: 'claude', model: 'test', effort: 'low' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => String(url).includes('PMC404') ? new Response('', { status: 404 }) : new Response(xml, { status: 200 })));
});
async function waitJob(id: string) {
  await vi.waitFor(() => expect(['done', 'error']).toContain(getJobRow(id)?.status));
  expect(getJobRow(id)?.error).toBeNull();
}
describe('문헌 분석 API', () => {
  it('전문과 근거를 분석하고 전문 없는 자료도 보고서에 보존한다', async () => {
    const res = await app.request(`/api/cell-lines/${lineId}/literature`, request('POST', { papers, providerUrl: null, providerText: null, query: 'test', bankFilter: 'KCLB' }));
    expect(res.status).toBe(200); const { jobId } = await res.json() as { jobId: string }; await waitJob(jobId);
    const summaries = await (await app.request(`/api/cell-lines/${lineId}/literature`)).json() as { id: string; okCount: number; sourceCount: number }[];
    expect(summaries[0]).toMatchObject({ okCount: 1, sourceCount: 2 });
    const report = await (await app.request(`/api/literature/${summaries[0].id}`)).json() as LiteratureReport;
    expect(report.sources.map((s) => s.status)).toEqual(['ok', 'no_fulltext']);
    expect(report.sources[0].fields?.base_medium.value).toBe('DMEM');
    expect(report.sources[0].evidence['S1-1'].text).toBe('HeLa cells were obtained from the Korean Cell Line Bank (KCLB, Seoul, Republic of Korea; KCLB No. 10002).');
    expect(report.sources[0].evidence['S1-2'].text).toBe('HeLa cells were cultured in DMEM supplemented with 10% FBS & 1% penicillin.');
    expect(report.by?.model).toBe('test'); expect(runLlm).toHaveBeenCalledTimes(1);
    expect((await app.request(`/api/literature/${report.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/literature/${report.id}`)).status).toBe(404);
  });
  it('빈 입력과 잘못된 논문 정보를 AI 호출 전에 거부한다', async () => {
    expect((await app.request(`/api/cell-lines/${lineId}/literature`, request('POST', { papers: [], providerUrl: null, providerText: null }))).status).toBe(400);
    expect((await app.request(`/api/cell-lines/${lineId}/literature`, request('POST', { papers: [{ ...papers[0], pmcid: '../bad' }] }))).status).toBe(400);
    expect(runLlm).not.toHaveBeenCalled();
  });
  it('형식 오류만 한 번 JSON으로 재요청한다', async () => {
    vi.mocked(runLlm).mockResolvedValueOnce({ text: 'invalid', by: { engine: 'claude', model: 'test', effort: 'low' } });
    const { jobId } = await (await app.request(`/api/cell-lines/${lineId}/literature`, request('POST', { papers: [papers[0]] }))).json() as { jobId: string };
    await waitJob(jobId); expect(runLlm).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runLlm).mock.calls[1][0].prompt).toContain('(설명 없이 JSON 객체 하나만 출력하라.)');
  });
  it('분양처 페이지를 읽을 수 없으면 붙여넣기 안내를 저장한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>')));
    const { jobId } = await (await app.request(`/api/cell-lines/${lineId}/literature`, request('POST', { papers: [], providerUrl: 'https://example.org' }))).json() as { jobId: string }; await waitJob(jobId);
    const row = db.prepare('SELECT content FROM literature_reports WHERE cell_line_id=?').get(lineId) as { content: string };
    const report = JSON.parse(row.content) as LiteratureReport;
    expect(report.sources[0].status).toBe('fetch_failed'); expect(report.sources[0].error).toContain('붙여넣어 주세요'); expect(runLlm).not.toHaveBeenCalled();
  });
  it('취소된 작업은 보고서를 저장하지 않는다', async () => {
    const { promise: pending, resolve: release } = Promise.withResolvers<void>();
    vi.mocked(runLlm).mockImplementationOnce(async () => { await pending; return { text: '{"fields":{}}', by: { engine: 'claude', model: 'test', effort: 'low' } }; });
    const { jobId } = await (await app.request(`/api/cell-lines/${lineId}/literature`, request('POST', { papers: [papers[0]] }))).json() as { jobId: string };
    await vi.waitFor(() => expect(runLlm).toHaveBeenCalledOnce()); cancelJob(jobId); release();
    await vi.waitFor(() => expect(getJobRow(jobId)?.status).toBe('error'));
    expect(db.prepare('SELECT COUNT(*) AS n FROM literature_reports').get()).toMatchObject({ n: 0 });
  });
});
