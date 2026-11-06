import dagre from '@dagrejs/dagre';
import { Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import type { Edge, Node, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FlaskConical, TestTube } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CellLineDetailDto, CellLineDto, CellLineLogDto, LogDto, LotDto } from '../../shared/cell-line';
import type { LineageGraph, LineageNode } from '../../shared/lineage';
import { api } from '../api';
import { inputCls, smallBtnCls } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { useResolvedTheme } from '../state/theme';
import { CULTURE_STATUS_LABELS, logLabels, NodeDrawer } from './NodeDrawer';
import { LogDialog, ReceiveCultureDialog, ReceiveLotDialog, ThawDialog } from './dialogs/CultureDialogs';
import { QuickRecord } from './QuickRecord';
import './lineage-workspace.css';

type FlowNode = Node<{ work: LineageNode; detail: string }, 'lineage'>;
function StockCard({ data, selected }: NodeProps<FlowNode>) {
  const n = data.work;
  return (
    <div className={`cell-graph-node ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="cell-node-meta">
        {n.kind === 'lot' ? <TestTube size={12} /> : <FlaskConical size={12} />}
        <span className={`cell-status-dot status-${n.status}`} />
        {n.kind === 'lot' ? '바이알' : CULTURE_STATUS_LABELS[n.status as keyof typeof CULTURE_STATUS_LABELS]} · P{n.passage ?? '미정'}
      </div>
      <strong title={n.label}>{n.label}</strong>
      <p>{data.detail}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { lineage: StockCard };
interface Props {
  line: CellLineDto;
  focusNodeId: string | null;
  onSelectNode(id: string | null): void;
  onChanged(): void;
}
export function LineageView(props: Props) {
  return (
    <ReactFlowProvider>
      <LineageInner {...props} />
    </ReactFlowProvider>
  );
}
function LineageInner({ line, focusNodeId, onSelectNode, onChanged }: Props) {
  const { fitView } = useReactFlow();
  const theme = useResolvedTheme();
  const toast = useToast();
  const container = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState<LineageGraph>({ nodes: [], edges: [] });
  const [detail, setDetail] = useState<CellLineDetailDto | null>(null);
  const [logs, setLogs] = useState<CellLineLogDto[]>([]);
  const [hideEnded, setHideEnded] = useState(false);
  const [filterCulture, setFilterCulture] = useState('');
  const [filterType, setFilterType] = useState('');
  const [dialog, setDialog] = useState<'lot' | 'culture' | null>(null);
  const [editing, setEditing] = useState<LogDto | null>(null);
  const [thaw, setThaw] = useState<LotDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const load = useCallback(async () => {
    const version = ++request.current;
    try {
      const [g, d, l] = await Promise.all([
        api<LineageGraph>(`/api/cell-lines/${line.id}/lineage`),
        api<CellLineDetailDto>(`/api/cell-lines/${line.id}`),
        api<CellLineLogDto[]>(`/api/cell-lines/${line.id}/logs`),
      ]);
      if (version !== request.current) return;
      setGraph(g);
      setDetail(d);
      setLogs(l);
      setError(null);
    } catch (e) {
      if (version === request.current) setError((e as Error).message);
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [line.id]);
  useEffect(() => {
    setLoading(true);
    setDetail(null);
    setLogs([]);
    setGraph({ nodes: [], edges: [] });
    void load();
    return () => {
      ++request.current;
    };
  }, [load]);
  const selected =
    focusNodeId ?? detail?.cultures.find((c) => c.status === 'active')?.id ?? detail?.cultures[0]?.id ?? detail?.lots[0]?.id ?? null;
  const visible = useMemo(() => graph.nodes.filter((n) => !hideEnded || n.kind === 'lot' || n.status === 'active'), [graph, hideEnded]);
  const topology = JSON.stringify([visible.map((n) => n.id), graph.edges.map((e) => [e.source, e.target])]);
  const positions = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 68, edgesep: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    const [ids, links] = JSON.parse(topology) as [string[], [string, string][]];
    const included = new Set(ids);
    for (const id of ids) g.setNode(id, { width: 180, height: 82 });
    for (const [source, target] of links) if (included.has(source) && included.has(target)) g.setEdge(source, target);
    dagre.layout(g);
    return new Map(
      ids.map((id) => {
        const p = g.node(id) as { x: number; y: number };
        return [id, { x: p.x - 90, y: p.y - 41 }];
      }),
    );
  }, [topology]);
  const nodes = useMemo<FlowNode[]>(
    () =>
      visible.map((work) => {
        const lot = detail?.lots.find((l) => l.id === work.id);
        const culture = detail?.cultures.find((c) => c.id === work.id);
        return {
          id: work.id,
          type: 'lineage',
          selected: selected === work.id,
          position: positions.get(work.id)!,
          data: {
            work,
            detail: lot
              ? `${lot.vialsRemaining}/${lot.vialsInitial} vial · ${lot.location || '위치 미정'}`
              : `${culture?.vessel ?? ''} · ${work.lastConfluency != null ? `${work.lastConfluency}%` : '관찰값 없음'}`,
          },
        };
      }),
    [visible, detail, selected, positions],
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges
        .filter((e) => positions.has(e.source) && positions.has(e.target))
        .map((e) => ({ ...e, type: 'smoothstep', label: { thaw: '해동', passage: '계대', freeze: '동결' }[e.kind] })),
    [graph.edges, positions],
  );
  useEffect(() => {
    if (!container.current) return;
    let timer: number | undefined;
    const fit = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void fitView({ padding: 0.18, maxZoom: 1 }), 60);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container.current);
    fit();
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [topology, fitView]);
  const changed = () => {
    void load();
    onChanged();
  };
  const lot = detail?.lots.find((l) => l.id === selected);
  const culture = detail?.cultures.find((c) => c.id === selected);
  const dialogProps = { line, profiles: detail?.profiles ?? [], onClose: () => setDialog(null), onSaved: changed };
  const daily = logs.filter((l) => (!filterCulture || l.cultureId === filterCulture) && (!filterType || l.type === filterType));
  const editCulture = detail?.cultures.find((c) => c.id === editing?.cultureId);
  async function remove(log: LogDto) {
    if (!confirm('이 기록을 삭제할까요?')) return;
    try {
      await api(`/api/logs/${log.id}`, { method: 'DELETE' });
      changed();
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    }
  }
  return (
    <div className="cell-workspace">
      <div className="cell-workspace-toolbar">
        <button className={smallBtnCls} onClick={() => setDialog('lot')}>
          stock 입고(바이알)
        </button>
        <button className={smallBtnCls} onClick={() => setDialog('culture')}>
          배양 상태로 입고
        </button>
      </div>
      {error && (
        <div role="alert" className="text-danger text-sm">
          {error}{' '}
          <button className={smallBtnCls} onClick={() => void load()}>
            다시 불러오기
          </button>
        </div>
      )}
      {loading && <p className="cell-empty">계보·기록을 불러오는 중…</p>}
      <div className="cell-workspace-columns">
        <div className="cell-workspace-main">
          <section className="workbench-panel">
            <div className="cell-panel-heading">
              <h3>배양 계보</h3>
              <label>
                <input type="checkbox" checked={hideEnded} onChange={(e) => setHideEnded(e.target.checked)} /> 종료된 배양 숨기기
              </label>
              <button className={smallBtnCls} onClick={() => void fitView({ padding: 0.18, maxZoom: 1 })}>
                전체 보기
              </button>
            </div>
            <div ref={container} className="cell-graph">
              {!loading && !graph.nodes.length && <div className="cell-graph-empty">stock 또는 배양을 입고하여 계보를 시작하세요.</div>}
              <ReactFlow
                colorMode={theme}
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                onNodeClick={(_, n) => onSelectNode(n.id)}
                minZoom={0.1}
                proOptions={{ hideAttribution: true }}
              >
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          </section>
          <section className="workbench-panel">
            <div className="cell-panel-heading">
              <h3>날짜별 기록</h3>
              <span>최신순 · {daily.length}건</span>
            </div>
            <div className="cell-log-filters">
              <select aria-label="배양 필터" className={inputCls} value={filterCulture} onChange={(e) => setFilterCulture(e.target.value)}>
                <option value="">모든 배양</option>
                {detail?.cultures.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select aria-label="기록 종류 필터" className={inputCls} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="">모든 기록</option>
                {Object.entries(logLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="cell-table-scroll">
              <table className="cell-workspace-table">
                <thead>
                  <tr>
                    <th>일시</th>
                    <th>배양 · P</th>
                    <th>Confluency</th>
                    <th>기록</th>
                    <th>수행자 / 메모</th>
                    <th>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((l) => (
                    <tr key={l.id} className={selected === l.cultureId ? 'is-selected' : ''} onClick={() => onSelectNode(l.cultureId)}>
                      <td>
                        {new Date(l.at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <button className="cell-text-button" onClick={() => onSelectNode(l.cultureId)}>
                          {l.cultureLabel} · P{l.culturePassage}
                        </button>
                      </td>
                      <td>{l.confluencyPct == null ? '—' : `${l.confluencyPct}%`}</td>
                      <td>{logLabels[l.type]}</td>
                      <td className="cell-log-note" title={l.note}>
                        {l.extra['수행자'] && `${l.extra['수행자']} · `}
                        {l.note || '—'}
                      </td>
                      <td>
                        {l.type === 'passage' || l.type === 'freeze' ? (
                          <span title="계보 무결성을 위해 수정·삭제할 수 없습니다">계보 기록 보호</span>
                        ) : (
                          <div className="cell-row-actions">
                            <button className={smallBtnCls} onClick={() => setEditing(l)}>
                              수정
                            </button>
                            <button className={smallBtnCls} onClick={() => void remove(l)}>
                              삭제
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && !daily.length && (
              <p className="cell-empty">
                {logs.length ? '필터에 맞는 기록이 없습니다.' : '아직 기록이 없습니다. 오른쪽에서 오늘의 기록을 남기세요.'}
              </p>
            )}
          </section>
        </div>
        <div className="cell-workspace-side">
          <QuickRecord
            line={line}
            cultures={detail?.cultures ?? []}
            lots={detail?.lots ?? []}
            profiles={detail?.profiles ?? []}
            selected={selected}
            onSelect={onSelectNode}
            onSaved={changed}
            onReceive={() => setDialog('culture')}
          />
          {lot || culture ? (
            <NodeDrawer
              key={selected}
              line={line}
              lot={lot}
              culture={culture}
              logs={logs.filter((l) => l.cultureId === culture?.id)}
              profiles={detail?.profiles ?? []}
              onClose={() => onSelectNode(null)}
              onChanged={changed}
            />
          ) : (
            <section className="workbench-panel cell-selection">
              <h3>선택한 배양</h3>
              <p className="cell-empty">계보 또는 기록표에서 배양을 선택하세요.</p>
            </section>
          )}
        </div>
      </div>
      <section className="workbench-panel">
        <div className="cell-panel-heading">
          <h3>동결 · stock 재고</h3>
          <span>{detail?.lots.reduce((sum, l) => sum + l.vialsRemaining, 0) ?? 0} vial</span>
        </div>
        <div className="cell-table-scroll">
          <table className="cell-workspace-table">
            <thead>
              <tr>
                <th>라벨</th>
                <th>P</th>
                <th>남은 / 최초</th>
                <th>보관 위치</th>
                <th>입고 / 동결일</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {detail?.lots.map((l) => (
                <tr key={l.id} className={selected === l.id ? 'is-selected' : ''} onClick={() => onSelectNode(l.id)}>
                  <td>
                    <button className="cell-text-button" onClick={() => onSelectNode(l.id)}>
                      {l.label}
                    </button>
                  </td>
                  <td>{l.passage ?? '미정'}</td>
                  <td>
                    {l.vialsRemaining} / {l.vialsInitial}
                  </td>
                  <td>{l.location || '위치 미정'}</td>
                  <td>{new Date(l.eventAt).toLocaleDateString('ko-KR')}</td>
                  <td>
                    <div className="cell-row-actions">
                      <button
                        className={smallBtnCls}
                        disabled={!l.vialsRemaining}
                        title={!l.vialsRemaining ? '남은 바이알이 없습니다' : '해동'}
                        onClick={() => setThaw(l)}
                      >
                        해동
                      </button>
                      <button className={smallBtnCls} onClick={() => onSelectNode(l.id)}>
                        정보 · 수정
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !detail?.lots.length && <p className="cell-empty">동결 재고가 없습니다. stock을 입고하거나 활성 배양을 동결하세요.</p>}
      </section>
      {dialog === 'lot' && <ReceiveLotDialog {...dialogProps} />}
      {dialog === 'culture' && <ReceiveCultureDialog {...dialogProps} />}
      {editing && editCulture && (
        <LogDialog
          line={line}
          profiles={detail?.profiles ?? []}
          culture={editCulture}
          initialLog={editing}
          onClose={() => setEditing(null)}
          onSaved={changed}
        />
      )}
      {thaw && <ThawDialog line={line} profiles={detail?.profiles ?? []} lot={thaw} onClose={() => setThaw(null)} onSaved={changed} />}
    </div>
  );
}
