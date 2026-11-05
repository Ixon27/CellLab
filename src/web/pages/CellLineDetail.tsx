import { useCallback, useEffect, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import type { CellLineDetailDto } from '../../shared/cell-line';
import { api } from '../api';
import { Dialog, btnCls, primaryBtnCls, dangerBtnCls, inputCls } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { CellLineInfoForm } from '../cells/CellLineInfoForm';
import type { LineForm } from '../cells/CellLineInfoForm';
import { ProfileEditor } from '../cells/ProfileEditor';
import { LineageView } from '../cells/LineageView';
import { LiteraturePanel } from '../cells/LiteraturePanel';
import { SopPanel } from '../cells/SopPanel';
const tabs = [
  ['info', '정보'],
  ['profiles', '배양 조건'],
  ['literature', '문헌·분양처 비교'],
  ['lineage', '계보·재고'],
  ['sop', '배양 SOP'],
] as const;
export function CellLineDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<CellLineDetailDto | null>(null);
  const [form, setForm] = useState<LineForm | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const tab = params.get('tab') ?? 'info';
  const toast = useToast();
  const reload = useCallback(() => {
    api<CellLineDetailDto>(`/api/cell-lines/${id}`)
      .then((d) => {
        setDetail(d);
        const {
          name,
          species,
          tissue,
          disease,
          category,
          sex,
          growthMode,
          sourceBank,
          catalogNo,
          providerUrl,
          providers,
          doublingTime,
          caution,
          biosafety,
          maxPassage,
          tags,
          notes,
          synonyms,
          cellosaurusAc,
        } = d.line;
        setForm({
          name,
          species,
          tissue,
          disease,
          category,
          sex,
          growthMode,
          sourceBank,
          catalogNo,
          providerUrl,
          providers,
          doublingTime,
          caution,
          biosafety,
          maxPassage,
          tags,
          notes,
          synonyms,
          cellosaurusAc,
        });
      })
      .catch((e) => toast(String(e), { tone: 'error' }));
  }, [id, toast]);
  useEffect(reload, [reload]);
  function selectTab(next: string, profile?: string) {
    const p = new URLSearchParams();
    p.set('tab', next);
    if (profile) p.set('profile', profile);
    navigate(`/cells/${id}?${p}`);
  }
  async function save() {
    setBusy(true);
    try {
      await api(`/api/cell-lines/${id}`, { method: 'PUT', json: form });
      reload();
      toast('세포주 정보를 저장했습니다');
    } catch (e) {
      toast(String(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/api/cell-lines/${id}`, { method: 'DELETE' });
      navigate('/cells');
    } catch (e) {
      toast(String(e), { tone: 'error' });
      setBusy(false);
    }
  }
  if (!detail || !form) return <div className="p-6 text-fg-muted">세포주 정보를 불러오는 중입니다.</div>;
  return (
    <div className="mx-auto grid max-w-7xl gap-5 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{detail.line.name}</h1>
        <button className={dangerBtnCls} onClick={() => setDeleting(true)}>
          세포주 삭제
        </button>
      </header>
      {detail.line.caution && <div className="rounded-lg bg-danger-soft p-3 text-danger">{detail.line.caution}</div>}
      <nav className="flex flex-wrap gap-2 border-b border-line pb-3">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? primaryBtnCls : btnCls} onClick={() => selectTab(key)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === 'info' && (
        <>
          <CellLineInfoForm value={form} onChange={setForm} />
          <div className="flex gap-2">
            <button className={primaryBtnCls} disabled={busy} onClick={save}>
              저장
            </button>
            {form.providerUrl && (
              <button className={btnCls} onClick={() => window.open(form.providerUrl!, '_blank')}>
                분양처 페이지 열기
              </button>
            )}
          </div>
        </>
      )}
      {tab === 'profiles' && (
        <ProfileEditor
          lineId={id}
          profiles={detail.profiles}
          selectedId={params.get('profile')}
          onSelect={(profile) => selectTab('profiles', profile)}
          onChanged={reload}
        />
      )}{' '}
      {tab === 'literature' && (
        <LiteraturePanel
          line={detail.line}
          onProfileCreated={(profile: string) => {
            reload();
            selectTab('profiles', profile);
          }}
        />
      )}
      {tab === 'lineage' && <LineageView line={detail.line} focusNodeId={params.get('node')} onChanged={reload} />}{' '}
      {tab === 'sop' && <SopPanel line={detail.line} onChanged={reload} />}{' '}
      {deleting && (
        <Dialog
          title="세포주 삭제"
          onClose={() => setDeleting(false)}
          footer={
            <button className={dangerBtnCls} disabled={confirm !== detail.line.name || busy} onClick={remove}>
              영구 삭제
            </button>
          }
        >
          <p className="mb-3 text-sm">
            모든 배양 조건과 계보·기록이 함께 삭제됩니다. 확인하려면 세포주 이름을 입력하세요: {detail.line.name}
          </p>
          <input className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="삭제할 세포주 이름" />
        </Dialog>
      )}
    </div>
  );
}
