import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { OS_NAME } from '../labels';
import { setThemePref, useThemePref, type ThemePref } from '../state/theme';
import type { Settings, SystemInfo } from '../types';
import { btnCls, Dialog, inputCls, primaryBtnCls } from './Dialog';
import { PathRow, SettingsRow, SettingsSection } from './SettingsRows';
import { ProviderConnections } from './ProviderConnections';
import { useToast } from './Toast';

const THEMES: { id: ThemePref; label: string; Icon: typeof Sun }[] = [
  { id: 'system', label: '시스템', Icon: Monitor },
  { id: 'light', label: '밝게', Icon: Sun },
  { id: 'dark', label: '어둡게', Icon: Moon },
];

function ThemeSwitch() {
  const pref = useThemePref();
  return (
    <div role="radiogroup" aria-label="화면 모드" className="inline-flex rounded-lg bg-sunken p-0.5">
      {THEMES.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={pref === id}
          onClick={() => setThemePref(id)}
          className={`inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] ${
            pref === id ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
          }`}
        >
          <Icon size={13} aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

export function SettingsDialog({ onClose }: { onClose(): void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = async () => {
    setError(null);
    try {
      const [settings, info] = await Promise.all([api<Settings>('/api/settings'), api<SystemInfo>('/api/system')]);
      setS(settings);
      setSystem(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : '설정을 불러오지 못했습니다');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      await api<Settings>('/api/settings', {
        method: 'PUT',
        json: { contactEmail: s.contactEmail.trim() },
      });
      toast('설정을 저장했습니다');
      onClose();
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title="설정"
      width={600}
      onClose={onClose}
      footer={(close) => (
        <>
          <button className={btnCls} onClick={close}>
            취소
          </button>
          <button className={primaryBtnCls} disabled={!s || saving} onClick={() => void save()}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </>
      )}
    >
      {error && (
        <div role="alert" className="mb-3 text-[13px] text-danger">
          <p>{error}</p>
          <button className={`${btnCls} mt-2`} onClick={() => void load()}>
            다시 불러오기
          </button>
        </div>
      )}
      {!s || !system ? (
        !error && <p className="text-[13px] text-fg-muted">불러오는 중…</p>
      ) : (
        <>
          <SettingsSection title="화면">
            <SettingsRow label="화면 모드" description={`시스템은 ${OS_NAME} 설정을 따릅니다. 어둡게는 Tern 스타일의 어두운 화면입니다.`}>
              <ThemeSwitch />
            </SettingsRow>
          </SettingsSection>
          <ProviderConnections desktop={system.desktop} />
          <SettingsSection title="외부 데이터 조회">
            <SettingsRow
              label="연락처 이메일"
              labelFor="settings-email"
              aside={<span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-fg-dim">선택</span>}
              description="Cellosaurus·Europe PMC·분양처 페이지를 조회할 때 요청 헤더의 연락처로만 전달됩니다."
            >
              <input
                id="settings-email"
                type="email"
                className={inputCls}
                placeholder="name@example.com"
                value={s.contactEmail}
                onChange={(e) => setS({ ...s, contactEmail: e.target.value })}
              />
            </SettingsRow>
          </SettingsSection>
          <SettingsSection title="저장 위치">
            <PathRow label="실험 데이터" path={system.dataDir} home={system.home} target="data" />
            <PathRow label="첨부 파일" path={system.filesPath} home={system.home} target="files" />
          </SettingsSection>
        </>
      )}
    </Dialog>
  );
}
