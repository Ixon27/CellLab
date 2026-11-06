import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Switch, useLocation, useSearch } from 'wouter';
import {
  BookOpen,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  Moon,
  Rows3,
  Settings as SettingsIcon,
  Sun,
  TestTube,
  PanelLeft,
  Laptop,
  ChevronRight,
  Plus,
  Search,
  Folder,
} from 'lucide-react';
import { api } from './api';
import type { Settings } from './types';
import type { CellLineListItem, CellLineDetailDto } from '../shared/cell-line';
import { AiPicker } from './components/AiPicker';
import { iconBtnCls } from './components/Dialog';
import { OnboardingDialog } from './components/OnboardingDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { isMac, SETTINGS_SHORTCUT } from './labels';
import { toggleTheme, useResolvedTheme } from './state/theme';
import { ToastProvider } from './components/Toast';
import { Catalog } from './pages/Catalog';
import { CellLines } from './pages/CellLines';
import { CellLineDetail } from './pages/CellLineDetail';
import { BradfordList } from './pages/BradfordList';
import { BradfordEditor } from './pages/BradfordEditor';
import { Protocols } from './pages/Protocols';
import { ProtocolDetail } from './pages/ProtocolDetail';
import { WesternList } from './pages/WesternList';
import { WesternRun } from './pages/WesternRun';
import { Dashboard } from './pages/Dashboard';

function ThemeToggle() {
  const dark = useResolvedTheme() === 'dark';
  const label = dark ? '밝은 화면으로 전환' : '어두운 화면으로 전환';
  return (
    <button className={iconBtnCls} aria-label={label} title={label} onClick={toggleTheme}>
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function Header({ onToggleSidebar }: { onToggleSidebar(): void }) {
  const [location] = useLocation();
  const section = NAV.find((item) => item.href !== '/' && location.startsWith(item.href))?.label ?? '대시보드';
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => window.cellLabDesktop?.onOpenSettings(() => setSettingsOpen(true)), []);
  // The macOS app menu owns ⌘,; the Windows window has no menu bar, so the page handles Ctrl+,.
  useEffect(() => {
    if (!window.cellLabDesktop || isMac) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <header className="app-header ghost-titlebar app-drag relative z-40 flex shrink-0 items-center">
      <div className="cell-titlebar-tools ghost-titlebar-side">
        <button className={iconBtnCls} aria-label="사이드바 전환" title="사이드바 전환" onClick={onToggleSidebar}>
          <PanelLeft size={16} />
        </button>
        <Link href="/cells" className={iconBtnCls} aria-label="세포주 검색" title="세포주 검색">
          <Search size={15} />
        </Link>
      </div>
      <div className="cell-titlebar-main ghost-titlebar-main">
        <Link href="/" className="text-[12px] text-fg-muted">
          CellLab
        </Link>
        <ChevronRight size={12} className="text-fg-dim" aria-hidden />
        <span className="text-[12px]">{section}</span>
        <div className="flex-1" />
        <AiPicker />
        <ThemeToggle />
        <button
          className={iconBtnCls}
          aria-label="설정"
          title={window.cellLabDesktop ? `설정 (${SETTINGS_SHORTCUT})` : '설정'}
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon size={16} />
        </button>
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}

const NAV = [
  { href: '/', label: '대시보드', Icon: LayoutDashboard },
  { href: '/cells', label: '세포주', Icon: FlaskConical },
  { href: '/bradford', label: 'Bradford', Icon: TestTube },
  { href: '/western', label: 'Western blot', Icon: Rows3 },
  { href: '/protocols', label: '프로토콜', Icon: BookOpen },
  { href: '/catalog', label: '선택 목록', Icon: ListChecks },
] as const;

function Sidebar() {
  const [location] = useLocation();
  const search = useSearch();
  const focusedCulture = new URLSearchParams(search).get('node');
  const [lines, setLines] = useState<CellLineListItem[]>([]);
  const [error, setError] = useState(false);
  const selectedLine = location.match(/^\/cells\/([^/?]+)/)?.[1] ?? null;
  const [expanded, setExpanded] = useState<string | null>(selectedLine);
  const [detail, setDetail] = useState<CellLineDetailDto | null>(null);
  const [detailError, setDetailError] = useState(false);
  useEffect(() => setExpanded(selectedLine), [selectedLine]);
  useEffect(() => {
    setDetail(null);
    setDetailError(false);
    if (!expanded) return;
    let alive = true;
    void api<CellLineDetailDto>(`/api/cell-lines/${expanded}`)
      .then((value) => {
        if (alive) setDetail(value);
      })
      .catch(() => {
        if (alive) setDetailError(true);
      });
    return () => {
      alive = false;
    };
  }, [expanded, location]);
  useEffect(() => {
    let alive = true;
    void api<CellLineListItem[]>('/api/cell-lines')
      .then((rows) => {
        if (alive) {
          setLines(rows);
          setError(false);
        }
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [location]);
  return (
    <aside className="workbench-sidebar cell-shell-sidebar flex shrink-0 flex-col" aria-label="실험실 탐색">
      <div className="cell-local-status" title="데이터는 이 기기에 저장됩니다">
        <span>
          <Laptop size={14} /> Local
        </span>
        <span className="cell-local-saved">
          <i /> 이 기기에 저장됨
        </span>
      </div>
      <nav aria-label="주 메뉴" className="cell-nav-shortcuts">
        {NAV.slice(0, 4).map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            title={label}
            aria-label={label}
            aria-current={(href === '/' ? location === '/' : location.startsWith(href)) ? 'page' : undefined}
          >
            <Icon size={16} strokeWidth={1.6} />
          </Link>
        ))}
      </nav>
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-2.5">
        <div className="mb-1.5 flex items-center justify-between px-2.5">
          <p className="workbench-eyebrow">세포주</p>
          <Link href="/cells" className="text-fg-muted hover:text-fg" aria-label="세포주 관리" title="세포주 관리">
            <Plus size={14} />
          </Link>
        </div>
        {lines.map((line) => (
          <div key={line.id}>
            <div className="cell-project-row">
              <button
                className="cell-project-disclosure"
                aria-label={`${line.name} 배양 ${expanded === line.id ? '접기' : '펼치기'}`}
                aria-expanded={expanded === line.id}
                onClick={() => setExpanded((current) => (current === line.id ? null : line.id))}
              >
                <ChevronRight size={12} style={{ transform: expanded === line.id ? 'rotate(90deg)' : undefined }} />
              </button>
              <Link href={`/cells/${line.id}`} className="workbench-nav" aria-current={selectedLine === line.id ? 'page' : undefined}>
                <Folder size={15} strokeWidth={1.6} />
                <span className="min-w-0 flex-1 truncate">{line.name}</span>
                <span className="text-[11px] tabular-nums text-fg-dim">{line.activeCultures}</span>
              </Link>
            </div>
            {expanded === line.id && (
              <div className="cell-project-children">
                {detail?.cultures.map((culture) => (
                  <Link
                    key={culture.id}
                    className="workbench-nav"
                    aria-current={focusedCulture === culture.id ? 'page' : undefined}
                    href={`/cells/${line.id}?tab=lineage&node=${encodeURIComponent(culture.id)}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${culture.status === 'active' ? 'bg-success' : 'bg-line-strong'}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{culture.label}</span>
                    <span className="text-[10px] text-fg-dim">P{culture.passage}</span>
                  </Link>
                ))}
                {!detail && <p className="cell-tree-message">{detailError ? '배양을 불러오지 못했습니다' : '배양 불러오는 중…'}</p>}
                {detail && !detail.cultures.length && <p className="cell-tree-message">등록된 배양 없음</p>}
              </div>
            )}
          </div>
        ))}
        {!lines.length && !error && (
          <p className="px-2.5 pt-1 text-[12px] leading-relaxed text-fg-dim">
            세포주를 등록하면
            <br />
            이곳에서 바로 열 수 있습니다.
          </p>
        )}
        {error && (
          <Link href="/cells" className="block px-2.5 text-[12px] text-warning">
            목록을 불러오지 못했습니다. 세포주 열기
          </Link>
        )}
      </div>
      <nav aria-label="실험실 자료" className="space-y-0.5 border-t border-line px-2.5 py-3">
        <p className="workbench-eyebrow px-2.5 pb-1.5">자료</p>
        {NAV.slice(4).map(({ href, label, Icon }) => (
          <Link key={href} href={href} className="workbench-nav" aria-current={location.startsWith(href) ? 'page' : undefined}>
            <Icon size={15} strokeWidth={1.6} aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3 text-[11px] text-fg-dim">
        <span className="h-1 w-1 rounded-full bg-success" /> 이 기기에 저장됨
      </div>
    </aside>
  );
}

export function App() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const loadSetup = useCallback(async () => {
    if (!window.cellLabDesktop) return;
    setSetupError(null);
    try {
      const settings = await api<Settings>('/api/settings');
      setSetupOpen(!settings.onboardingDone);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : '초기 설정을 확인하지 못했습니다');
    }
  }, []);
  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);
  return (
    <ToastProvider>
      <div className="ghost-shell flex h-full flex-col">
        <Header onToggleSidebar={() => setSidebarOpen((open) => !open)} />
        {setupError && (
          <div role="alert" className="border-b border-danger/30 bg-danger-soft px-4 py-2 text-[13px] text-danger">
            {setupError}{' '}
            <button className="ml-2 underline" onClick={() => void loadSetup()}>
              다시 시도
            </button>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {sidebarOpen && <Sidebar />}
          <main className="min-h-0 min-w-0 flex-1 overflow-auto">
            <Switch>
              <Route path="/catalog">
                <Catalog />
              </Route>
              <Route path="/cells">
                <CellLines />
              </Route>
              <Route path="/cells/:id">{(params) => <CellLineDetail id={params.id} />}</Route>
              <Route path="/bradford">
                <BradfordList />
              </Route>
              <Route path="/bradford/:id">{(params) => <BradfordEditor id={params.id} />}</Route>
              <Route path="/protocols">
                <Protocols />
              </Route>
              <Route path="/protocols/:id">{(params) => <ProtocolDetail id={params.id} />}</Route>
              <Route path="/western">
                <WesternList />
              </Route>
              <Route path="/western/:id">{(params) => <WesternRun key={params.id} id={params.id} />}</Route>
              <Route path="/">
                <Dashboard />
              </Route>
              <Route>
                <div className="p-8 text-fg-muted">없는 페이지입니다.</div>
              </Route>
            </Switch>
          </main>
        </div>
      </div>
      {setupOpen && <OnboardingDialog onDone={() => setSetupOpen(false)} />}
    </ToastProvider>
  );
}
