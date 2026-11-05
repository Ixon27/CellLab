import { useCallback, useEffect, useState } from 'react';
import type { CellLineDto } from '../../shared/cell-line';
import type { LiteratureReport } from '../../shared/literature';
import type { EpmcHit } from '../../server/services/europepmc';
import { api } from '../api';
import { AiUsageNotice } from '../components/AiUsageNotice';
import { btnCls, inputCls, primaryBtnCls } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { useJob } from '../state/useJob';
import { ComparisonTable } from './ComparisonTable';
interface SearchResult {
  query: string;
  bankFilter: string | null;
  hitCount: number;
  hits: EpmcHit[];
}
interface ReportSummary {
  id: string;
  createdAt: string;
  sourceCount: number;
  okCount: number;
}
const BANKS: Record<string, true> = { ATCC: true, KCLB: true, DSMZ: true, ECACC: true, JCRB: true, 'RIKEN BRC': true, CLS: true };
export function LiteraturePanel({ line, onProfileCreated }: { line: CellLineDto; onProfileCreated(profileId: string): void }) {
  const toast = useToast();
  const bankAvailable = BANKS[line.sourceBank ?? ''] === true;
  const [providerUrl, setProviderUrl] = useState(line.providerUrl ?? '');
  const [providerText, setProviderText] = useState('');
  const [bank, setBank] = useState(bankAvailable);
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [reportId, setReportId] = useState('');
  const [report, setReport] = useState<LiteratureReport | null>(null);
  useEffect(() => {
    setProviderUrl(line.providerUrl ?? '');
    setProviderText('');
    setBank(bankAvailable);
    setSearch(null);
    setSelected([]);
  }, [line.id, line.providerUrl, bankAvailable]);
  const reload = useCallback(async () => {
    try {
      const rows = await api<ReportSummary[]>(`/api/cell-lines/${line.id}/literature`);
      setReports(rows);
      setReportId(rows[0]?.id ?? '');
    } catch (e) {
      toast(e instanceof Error ? e.message : '보고서를 불러오지 못했습니다', { tone: 'error' });
    }
  }, [line.id, toast]);
  const job = useJob(line.id, 'literature', { onFinish: () => void reload() });
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    let active = true;
    setReport(null);
    if (reportId)
      void api<LiteratureReport>(`/api/literature/${reportId}`)
        .then((r) => {
          if (active) setReport(r);
        })
        .catch((e: Error) => {
          if (active) toast(e.message, { tone: 'error' });
        });
    return () => {
      active = false;
    };
  }, [reportId, toast]);
  async function searchPapers(withBank = bank) {
    setSearching(true);
    try {
      const r = await api<SearchResult>(`/api/cell-lines/${line.id}/literature/search?bank=${withBank ? '1' : '0'}`);
      setSearch(r);
      setSelected(r.hits.slice(0, 5).map((p) => p.pmcid));
    } catch (e) {
      toast(e instanceof Error ? e.message : '논문 검색에 실패했습니다', { tone: 'error' });
    } finally {
      setSearching(false);
    }
  }
  async function start() {
    setStarting(true);
    try {
      const r = await api<{ jobId: string }>(`/api/cell-lines/${line.id}/literature`, {
        method: 'POST',
        json: {
          papers: search?.hits.filter((p) => selected.includes(p.pmcid)) ?? [],
          providerUrl: providerUrl.trim() || null,
          providerText: providerText.trim() || null,
          query: search?.query ?? null,
          bankFilter: search?.bankFilter ?? null,
        },
      });
      job.attach(r.jobId);
    } catch (e) {
      toast(e instanceof Error ? e.message : '자료 분석을 시작하지 못했습니다', { tone: 'error' });
    } finally {
      setStarting(false);
    }
  }
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-raised p-4 space-y-3">
        <h2 className="font-semibold">① 분양처 정보</h2>
        <label className="block text-sm">
          분양처 페이지 주소
          <input className={inputCls} value={providerUrl} onChange={(e) => setProviderUrl(e.target.value)} placeholder="https://…" />
        </label>
        <details>
          <summary className="cursor-pointer text-sm text-accent">페이지 내용 붙여넣기</summary>
          <p className="my-2 text-xs text-fg-muted">KCLB처럼 자동으로 읽을 수 없는 페이지는 내용을 복사해 붙여넣어 주세요.</p>
          <textarea
            aria-label="분양처 페이지 내용"
            className={`${inputCls} min-h-40`}
            maxLength={50000}
            value={providerText}
            onChange={(e) => setProviderText(e.target.value)}
          />
        </details>
      </section>
      <section className="rounded-xl border border-line bg-raised p-4 space-y-3">
        <h2 className="font-semibold">② 논문 검색</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            <input type="checkbox" disabled={!bankAvailable} checked={bank} onChange={(e) => setBank(e.target.checked)} className="mr-2" />
            같은 분양처 논문만
          </label>
          <button className={btnCls} disabled={searching} onClick={() => void searchPapers()}>
            {searching ? '검색 중…' : '논문 검색'}
          </button>
        </div>
        {search && (
          <>
            <p className="text-sm text-fg-muted">
              검색 결과 {search.hitCount.toLocaleString()}건 · {selected.length}/8편 선택
            </p>
            <details className="text-xs text-fg-dim">
              <summary>검색식</summary>
              {search.query}
            </details>
            {search.hitCount === 0 && search.bankFilter && (
              <button
                className={btnCls}
                onClick={() => {
                  setBank(false);
                  void searchPapers(false);
                }}
              >
                분양처 조건 없이 다시 검색
              </button>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="p-2">선택</th>
                    <th className="p-2">제목</th>
                    <th className="p-2">저널</th>
                    <th className="p-2">연도</th>
                    <th className="p-2">인용수</th>
                    <th className="p-2">원문</th>
                  </tr>
                </thead>
                <tbody>
                  {search.hits.map((p) => (
                    <tr className="border-b border-line" key={p.pmcid}>
                      <td className="p-2">
                        <input
                          type="checkbox"
                          aria-label={`${p.title} 선택`}
                          checked={selected.includes(p.pmcid)}
                          disabled={!selected.includes(p.pmcid) && selected.length >= 8}
                          onChange={(e) => setSelected(e.target.checked ? [...selected, p.pmcid] : selected.filter((id) => id !== p.pmcid))}
                        />
                      </td>
                      <td className="p-2">{p.title}</td>
                      <td className="p-2">{p.journal ?? '—'}</td>
                      <td className="p-2">{p.year ?? '—'}</td>
                      <td className="p-2">{p.cited}</td>
                      <td className="p-2">
                        <a className="text-accent" href={`https://europepmc.org/article/PMC/${p.pmcid}`} target="_blank" rel="noreferrer">
                          Europe PMC
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">③ 배양 조건 추출</h2>
        <AiUsageNotice
          profile="quick"
          requests={selected.length + (providerUrl.trim() || providerText.trim() ? 1 : 0)}
          detail="선택한 자료의 원문 근거만 사용하며 결과를 직접 확인해야 합니다."
        />
        <button
          className={primaryBtnCls}
          disabled={job.running || starting || (!selected.length && !providerUrl.trim() && !providerText.trim())}
          onClick={() => void start()}
        >
          선택한 자료에서 조건 추출
        </button>
        {job.running && (
          <div className="space-y-2">
            <progress className="w-full" value={job.job?.progress ?? 0} max={1} />
            <p className="text-sm">{job.job?.message ?? '자료 분석 중…'}</p>
            <button className={btnCls} onClick={() => void job.cancel().catch((e: Error) => toast(e.message, { tone: 'error' }))}>
              취소
            </button>
          </div>
        )}
        {job.job?.status === 'error' && (
          <p role="alert" className="text-sm text-danger">
            {job.job.error}
          </p>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">④ 분석 보고서</h2>
        {reports.length ? (
          <>
            <label className="block text-sm">
              보고서 선택
              <select className={inputCls} value={reportId} onChange={(e) => setReportId(e.target.value)}>
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.createdAt).toLocaleString('ko-KR')} · {r.okCount}/{r.sourceCount} 자료 분석 완료
                  </option>
                ))}
              </select>
            </label>
            {report && <ComparisonTable key={report.id} report={report} onProfileCreated={onProfileCreated} />}
          </>
        ) : (
          <p className="text-sm text-fg-muted">자료를 선택하고 조건을 추출하면 비교표가 여기에 표시됩니다.</p>
        )}
      </section>
    </div>
  );
}
