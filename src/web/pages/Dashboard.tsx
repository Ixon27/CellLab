import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { LogDto } from '../../shared/cell-line';
import { api } from '../api';
import { smallBtnCls } from '../components/Dialog';

interface DashboardData {
  activeCultures: { id: string; label: string; lineId: string; lineName: string; passage: number; vessel: string; startedAt: string; daysInCulture: number; lastLog: LogDto | null; daysSinceFeed: number; feedOverdue: boolean; overPassage: boolean }[];
  lowStock: { lotId: string; label: string; lineName: string; vialsRemaining: number }[];
  recentBradford: { id: string; title: string; performedAt: string }[];
  recentWestern: { id: string; title: string; performedAt: string; status: 'planned' | 'in_progress' | 'done' }[];
}
export function Dashboard() {
  const [, navigate] = useLocation();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await api<DashboardData>('/api/dashboard')); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <div className="mx-auto max-w-7xl space-y-6 p-6"><div className="flex items-center justify-between"><h1 className="text-xl font-semibold tracking-tight">대시보드</h1><button className={smallBtnCls} onClick={() => void load()}>새로 고침</button></div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}{!data && !error && <p className="text-sm text-fg-muted">불러오는 중…</p>}
    {data && <><section className="rounded-xl border border-line bg-surface p-4"><h2 className="mb-3 font-semibold">활성 배양 <span className="text-fg-muted">{data.activeCultures.length}</span></h2>{data.activeCultures.length === 0 ? <div className="py-8 text-center text-sm text-fg-muted">세포주를 등록하고 stock을 입고하세요 <Link href="/cells" className="ml-2 text-accent">세포주로 이동</Link></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-fg-muted"><tr>{['세포주', '라벨', 'P', '용기', '배양 일수', '마지막 confluency', '배지 교체 경과', '알림'].map(s => <th key={s} className="whitespace-nowrap px-2 py-2">{s}</th>)}</tr></thead><tbody>{data.activeCultures.map(c => { const href = `/cells/${c.lineId}?tab=lineage&node=${encodeURIComponent(c.id)}`; return <tr key={c.id} className="cursor-pointer border-t border-line hover:bg-sunken" onClick={() => navigate(href)}><td className="px-2 py-3">{c.lineName}</td><td className="px-2 py-3"><Link href={href} className="font-medium text-accent">{c.label}</Link></td><td className="px-2 py-3">{c.passage}</td><td className="px-2 py-3">{c.vessel}</td><td className="px-2 py-3">{c.daysInCulture}일</td><td className="px-2 py-3">{c.lastLog?.confluencyPct != null ? `${c.lastLog.confluencyPct}%` : '미정'}</td><td className="px-2 py-3">{c.daysSinceFeed}일</td><td className="px-2 py-3"><div className="flex gap-1">{c.feedOverdue && <span className="whitespace-nowrap rounded bg-warning-soft px-2 py-1 text-xs text-warning">배지 교체 지연</span>}{c.overPassage && <span className="whitespace-nowrap rounded bg-danger-soft px-2 py-1 text-xs text-danger">최대 passage 초과</span>}</div></td></tr>; })}</tbody></table></div>}</section>
    <div className="grid gap-4 xl:grid-cols-3"><section className="rounded-xl border border-line bg-surface p-4"><h2 className="mb-3 font-semibold">바이알 부족 (2개 이하)</h2>{data.lowStock.length === 0 && <p className="text-sm text-fg-muted">부족한 재고가 없습니다.</p>}{data.lowStock.map(l => <div key={l.lotId} className="border-t border-line py-3 text-sm"><div className="font-medium">{l.label}</div><div className="text-xs text-fg-muted">{l.lineName} · 남은 {l.vialsRemaining} 바이알</div></div>)}</section>
    <section className="rounded-xl border border-line bg-surface p-4"><h2 className="mb-3 font-semibold">최근 Bradford</h2>{!data.recentBradford.length && <p className="text-sm text-fg-muted">아직 정량 기록이 없습니다.</p>}{data.recentBradford.map(a => <Link key={a.id} href={`/bradford/${a.id}`} className="block border-t border-line py-3 text-sm text-accent">{a.title}<span className="mt-1 block text-xs text-fg-muted">{a.performedAt.slice(0, 10)}</span></Link>)}</section>
    <section className="rounded-xl border border-line bg-surface p-4"><h2 className="mb-3 font-semibold">최근 Western blot</h2>{!data.recentWestern.length && <p className="text-sm text-fg-muted">아직 실험 기록이 없습니다.</p>}{data.recentWestern.map(a => <Link key={a.id} href={`/western/${a.id}`} className="block border-t border-line py-3 text-sm text-accent">{a.title}<span className="mt-1 block text-xs text-fg-muted">{a.performedAt.slice(0, 10)} · {{ planned: '계획', in_progress: '진행 중', done: '완료' }[a.status]}</span></Link>)}</section></div></>}
  </div>;
}
