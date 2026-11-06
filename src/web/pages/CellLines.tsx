import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowUpRight, FlaskConical, Plus, Search, TriangleAlert } from 'lucide-react';
import type { CellLineListItem } from '../../shared/cell-line';
import { api } from '../api';
import { inputCls, primaryBtnCls } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { RegisterCellLineDialog } from '../cells/RegisterCellLineDialog';

export function CellLines() {
  const [lines, setLines] = useState<CellLineListItem[]>([]);
  const [q, setQ] = useState('');
  const [register, setRegister] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [, navigate] = useLocation();
  const toast = useToast();
  useEffect(() => {
    api<CellLineListItem[]>('/api/cell-lines')
      .then((rows) => {
        setLines(rows);
        setLoaded(true);
      })
      .catch((e: Error) => toast(e.message, { tone: 'error' }));
  }, [toast]);
  const filtered = lines.filter((l) => [l.name, l.species, ...l.tags].join(' ').toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(filtered.map((l) => l.category || '기타'))];
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6 lg:px-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="workbench-eyebrow mb-1">Cell library</p>
          <h1 className="text-[20px] font-semibold tracking-tight">세포주</h1>
          <p className="mt-1.5 text-[12px] text-fg-muted">세포주를 열어 배양 계보와 일별 기록을 이어가세요.</p>
        </div>
        <button className={primaryBtnCls} onClick={() => setRegister(true)}>
          <Plus size={14} />
          세포주 등록
        </button>
      </header>
      <div className="relative mb-7 max-w-sm">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-fg-dim" />
        <input
          className={`${inputCls} !pl-8`}
          aria-label="세포주 검색"
          placeholder="이름, 태그, 종으로 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {groups.map((group) => (
        <section key={group} className="mb-6">
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="workbench-eyebrow">{group}</span>
            <span className="text-[11px] tabular-nums text-fg-dim">{filtered.filter((l) => (l.category || '기타') === group).length}</span>
          </div>
          <div className="workbench-panel divide-y divide-line">
            {filtered
              .filter((l) => (l.category || '기타') === group)
              .map((l) => (
                <Link key={l.id} href={`/cells/${l.id}`} className="group flex items-center gap-4 px-4 py-4 hover:bg-hover">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-fg-muted">
                    <FlaskConical size={17} strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[14px] font-semibold">{l.name}</h3>
                      {l.caution && (
                        <span title={l.caution}>
                          <TriangleAlert size={13} className="text-warning" aria-label="주의 사항 있음" />
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-fg-muted">
                      {[l.species, [l.sourceBank, l.catalogNo].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="hidden min-w-0 max-w-56 flex-1 text-[12px] text-fg-muted xl:block">
                    <span className="block truncate">{l.activeProfileName || '배양 조건 미설정'}</span>
                  </div>
                  <div className="flex shrink-0 gap-5 text-right text-[12px] tabular-nums">
                    <div>
                      <span className="font-medium">{l.activeCultures}</span>
                      <span className="ml-1.5 text-fg-dim">배양</span>
                    </div>
                    <div>
                      <span className="font-medium">{l.vialsRemaining}</span>
                      <span className="ml-1.5 text-fg-dim">바이알</span>
                    </div>
                  </div>
                  <ArrowUpRight size={14} className="shrink-0 text-fg-dim group-hover:text-fg" aria-hidden />
                </Link>
              ))}
          </div>
        </section>
      ))}
      {!loaded && <p className="text-[13px] text-fg-muted">세포주를 불러오는 중…</p>}
      {loaded && !filtered.length && (
        <div className="workbench-panel px-8 py-14 text-center">
          <FlaskConical size={24} strokeWidth={1.3} className="mx-auto mb-3 text-fg-dim" />
          <p className="font-medium">{q ? '검색 결과가 없습니다' : '첫 세포주를 등록하세요'}</p>
          <p className="mb-5 mt-1 text-[12px] text-fg-muted">
            {q ? '다른 이름이나 태그로 검색해 보세요.' : 'Cellosaurus에서 찾거나 직접 입력할 수 있습니다.'}
          </p>
          {!q && (
            <button className={primaryBtnCls} onClick={() => setRegister(true)}>
              <Plus size={14} />
              세포주 등록
            </button>
          )}
        </div>
      )}
      {register && <RegisterCellLineDialog onClose={() => setRegister(false)} onCreated={(l) => navigate(`/cells/${l.id}`)} />}
    </div>
  );
}
