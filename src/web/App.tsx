import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Switch, useLocation } from 'wouter';
import { BookOpen, FlaskConical, LayoutDashboard, ListChecks, Moon, Rows3, Settings as SettingsIcon, Sun, TestTube } from 'lucide-react';
import { api } from './api';
import type { Settings } from './types';
import { AiPicker } from './components/AiPicker';
import { iconBtnCls } from './components/Dialog';
import { OnboardingDialog } from './components/OnboardingDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { isMac, SETTINGS_SHORTCUT } from './labels';
import { toggleTheme, useResolvedTheme } from './state/theme';
import { ToastProvider } from './components/Toast';

function ThemeToggle() {
  const dark = useResolvedTheme() === 'dark';
  const label = dark ? '밝은 화면으로 전환' : '어두운 화면으로 전환';
  return (
    <button className={iconBtnCls} aria-label={label} title={label} onClick={toggleTheme}>
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function Header() {
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
    <header className="app-header app-drag relative z-40 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur-md">
      <Link href="/" className="rounded-lg py-1 pr-2 text-[15px] font-semibold tracking-tight text-fg">
        CellLab
      </Link>
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
  return (
    <nav aria-label="주 메뉴" className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-line bg-surface/60 p-2">
      {NAV.map(({ href, label, Icon }) => {
        const active = href === '/' ? location === '/' : location === href || location.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] ${
              active ? 'bg-accent-soft font-medium text-accent' : 'text-fg-muted hover:bg-sunken hover:text-fg'
            }`}
          >
            <Icon size={16} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function App() {
  const [setupOpen, setSetupOpen] = useState(false);
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
  useEffect(() => { void loadSetup(); }, [loadSetup]);
  return (
    <ToastProvider>
      <div className="flex h-full flex-col">
        <Header />
        {setupError && <div role="alert" className="border-b border-danger/30 bg-danger-soft px-4 py-2 text-[13px] text-danger">
          {setupError} <button className="ml-2 underline" onClick={() => void loadSetup()}>다시 시도</button>
        </div>}
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-h-0 min-w-0 flex-1 overflow-auto">
            <Switch>
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
