import dagre from '@dagrejs/dagre';
import { Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import type { Edge, Node, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FlaskConical, TestTube } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CellLineDetailDto, CellLineDto } from '../../shared/cell-line';
import type { LineageGraph, LineageNode } from '../../shared/lineage';
import { api } from '../api';
import { smallBtnCls } from '../components/Dialog';
import { CULTURE_STATUS_LABELS, NodeDrawer } from './NodeDrawer';
import { ReceiveCultureDialog, ReceiveLotDialog } from './dialogs/CultureDialogs';

type FlowNode = Node<{ work: LineageNode; detail: string }, 'lineage'>;
function StockCard({ data, selected }: NodeProps<FlowNode>) {
  const n = data.work;
  const danger = n.status === 'contaminated' || n.status === 'discarded';
  return <div className={`h-[120px] w-[240px] rounded-lg border bg-surface p-3 shadow-sm ${selected ? 'border-accent ring-2 ring-accent/30' : danger ? 'border-danger' : 'border-line'}`}>
    <Handle type="target" position={Position.Left} />
    <div className={`mb-1 flex items-center gap-2 text-xs ${danger ? 'text-danger' : n.status === 'active' ? 'text-success' : 'text-fg-muted'}`}>{n.kind === 'lot' ? <TestTube size={14} /> : <FlaskConical size={14} />}<span>{n.kind === 'lot' ? '바이알' : CULTURE_STATUS_LABELS[n.status as keyof typeof CULTURE_STATUS_LABELS]} · P{n.passage ?? '미정'}</span></div>
    <div className="truncate text-sm font-semibold text-fg" title={n.label}>{n.label}</div><div className="mt-1 line-clamp-2 text-xs text-fg-muted">{data.detail}</div>
    <Handle type="source" position={Position.Right} />
  </div>;
}
const nodeTypes = { lineage: StockCard };
export function LineageView(props: { line: CellLineDto; focusNodeId: string | null; onChanged(): void }) {
  return <ReactFlowProvider><LineageInner {...props} /></ReactFlowProvider>;
}
function LineageInner({ line, focusNodeId, onChanged }: { line: CellLineDto; focusNodeId: string | null; onChanged(): void }) {
  const { fitView } = useReactFlow();
  const container = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState<LineageGraph>({ nodes: [], edges: [] });
  const [detail, setDetail] = useState<CellLineDetailDto | null>(null);
  const [selected, setSelected] = useState<string | null>(focusNodeId);
  const [hideEnded, setHideEnded] = useState(false);
  const [dialog, setDialog] = useState<'lot' | 'culture' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const [g, d] = await Promise.all([api<LineageGraph>(`/api/cell-lines/${line.id}/lineage`), api<CellLineDetailDto>(`/api/cell-lines/${line.id}`)]);
      setGraph(g); setDetail(d); setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [line.id]);
  useEffect(() => { setLoading(true); setSelected(focusNodeId); void load(); }, [load]);
  useEffect(() => { setSelected(focusNodeId); }, [focusNodeId]);
  const visible = useMemo(() => graph.nodes.filter(n => !hideEnded || n.kind === 'lot' || n.status === 'active' || n.id === selected), [graph, hideEnded, selected]);
  const nodes = useMemo<FlowNode[]>(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 110, edgesep: 24 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of visible) g.setNode(n.id, { width: 240, height: 120 });
    const ids = new Set(visible.map(n => n.id));
    for (const e of graph.edges) if (ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target);
    dagre.layout(g);
    return visible.map(work => {
      const point = g.node(work.id) as { x: number; y: number };
      const lot = detail?.lots.find(l => l.id === work.id);
      const culture = detail?.cultures.find(c => c.id === work.id);
      return { id: work.id, type: 'lineage', selected: selected === work.id, position: { x: point.x - 120, y: point.y - 60 }, data: { work, detail: lot ? `남은 ${lot.vialsRemaining}/${lot.vialsInitial} · ${lot.location || '위치 미정'}` : `${culture?.vessel ?? ''} · Confluency ${work.lastConfluency ?? '미정'}${work.lastConfluency != null ? '%' : ''}` } };
    });
  }, [visible, graph.edges, detail, selected]);
  const edges = useMemo<Edge[]>(() => {
    const ids = new Set(visible.map(n => n.id));
    return graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({ ...e, type: 'smoothstep', label: { thaw: '해동', passage: '계대', freeze: '동결' }[e.kind] }));
  }, [graph.edges, visible]);
  useEffect(() => {
    if (!container.current) return;
    let timer: number | undefined;
    const fit = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void fitView({ padding: 0.15 }), 60); };
    const observer = new ResizeObserver(fit); observer.observe(container.current); fit();
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [nodes, fitView]);
  const changed = () => { void load(); onChanged(); };
  const lot = detail?.lots.find(l => l.id === selected);
  const culture = detail?.cultures.find(c => c.id === selected);
  const dialogProps = { line, profiles: detail?.profiles ?? [], onClose: () => setDialog(null), onSaved: changed };
  return <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><button className={smallBtnCls} onClick={() => setDialog('lot')}>stock 입고(바이알)</button><button className={smallBtnCls} onClick={() => setDialog('culture')}>배양 상태로 입고</button><label className="ml-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={hideEnded} onChange={e => setHideEnded(e.target.checked)} />종료된 배양 숨기기</label></div>
    {error && <div role="alert" className="text-sm text-danger">{error} <button className={smallBtnCls} onClick={() => void load()}>다시 불러오기</button></div>}
    {loading && <p className="text-sm text-fg-muted">계보를 불러오는 중…</p>}
    {!loading && graph.nodes.length === 0 && !error && <p className="text-sm text-fg-muted">stock을 입고하여 계보를 시작하세요.</p>}
    <div className="flex flex-col gap-3 lg:flex-row"><div ref={container} className="relative h-[580px] min-w-0 flex-1 rounded-xl border border-line"><ReactFlow colorMode="system" nodes={nodes} edges={edges} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, n) => setSelected(n.id)} onPaneClick={() => setSelected(null)} fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.1} proOptions={{ hideAttribution: true }}><Controls showInteractive={false} /></ReactFlow></div>{(lot || culture) && <NodeDrawer key={selected} line={line} lot={lot} culture={culture} profiles={detail?.profiles ?? []} onClose={() => setSelected(null)} onChanged={changed} />}</div>
    {dialog === 'lot' && <ReceiveLotDialog {...dialogProps} />}{dialog === 'culture' && <ReceiveCultureDialog {...dialogProps} />}
  </div>;
}
