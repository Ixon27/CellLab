import dagre from '@dagrejs/dagre';
import { Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import type { Edge, Node, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FlaskConical, TestTube } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CellLineDetailDto, CellLineDto, CellLineLogDto, LogDto, LotDto } from '../../shared/cell-line';
import { splitConditionSnapshot } from '../../shared/culture-plan';
import type { LineageGraph, LineageNode } from '../../shared/lineage';
import { LEFTOVER_LABELS, PLATE_STATUS_LABELS, RECOVERY_LABELS, type PlateStatus } from '../../shared/culture-operations';
import { formatCount } from '../../shared/cell-count';
import { api } from '../api';
import { inputCls, smallBtnCls } from '../components/Dialog';
import { useResolvedTheme } from '../state/theme';
import { CULTURE_STATUS_LABELS, NodeDrawer } from './NodeDrawer';
import { ReceiveCultureDialog, ReceiveLotDialog, ThawDialog } from './dialogs/CultureDialogs';
import { ProtocolChanges } from './ProtocolRun';
import { QuickRecord } from './QuickRecord';
import { logLabels, OperationLogDialog, RecordActions, recordTitle, type LineageWorkspace } from './RecordActions';
import './lineage-workspace.css';

type StockNode = Node<{ work: LineageNode; detail: string; plates: number; expanded: boolean; onToggle(): void }, 'lineage'>;
type PlateNode = Node<{ cultureId: string; no: number; status: PlateStatus }, 'plate'>;
type FlowNode = StockNode | PlateNode;
/** An edge carries the record of the operation that drew it, so clicking it opens that record. */
type FlowEdge = Edge<{ logId: string | null }>;
const NODE_SIZE = { lineage: { width: 180, height: 82 }, plate: { width: 128, height: 40 } } as const;
function StockCard({ data, selected }: NodeProps<StockNode>) {
  const n = data.work;
  return (
    <div className={`cell-graph-node ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="cell-node-meta">
        {n.kind === 'lot' ? <TestTube size={12} /> : <FlaskConical size={12} />}
        <span className={`cell-status-dot status-${n.status}`} />
        {n.kind === 'lot' ? '바이알' : CULTURE_STATUS_LABELS[n.status as keyof typeof CULTURE_STATUS_LABELS]} · P{n.passage ?? '미정'}
        {!!n.protocolChangedRecords && (
          <span className="cell-node-sop" title={`프로토콜 단계를 바꿔 수행한 기록 ${n.protocolChangedRecords}건`}>
            SOP 변경 {n.protocolChangedRecords}
          </span>
        )}
        {data.plates > 1 && (
          <button
            type="button"
            className="cell-node-toggle nodrag"
            aria-expanded={data.expanded}
            title={data.expanded ? 'plate 접기' : 'plate별로 펼치기'}
            onClick={(e) => {
              e.stopPropagation();
              data.onToggle();
            }}
          >
            {data.expanded ? '▾ 접기' : `▸ ${data.plates}개`}
          </button>
        )}
      </div>
      <strong title={n.label}>{n.label}</strong>
      <p>{data.detail}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
function PlateCard({ data, selected }: NodeProps<PlateNode>) {
  return (
    <div className={`cell-graph-plate status-${data.status} ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <strong>plate {data.no}</strong>
      <span>{PLATE_STATUS_LABELS[data.status]}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { lineage: StockCard, plate: PlateCard };
/**
 * 수행자/메모 cell: summary facts on one muted line, then the note as written (line breaks kept). The condition snapshot
 * the app appended stays in the selected culture's record list; here it is only flagged.
 */
function JournalNote({ log }: { log: LogDto }) {
  const { text, snapshot } = splitConditionSnapshot(log.note);
  const facts = [
    log.extra['수행자'],
    log.feed && `${log.feed.mediumLabel ?? '배지 미기록'} · 제거 ${log.feed.removedMl ?? '?'} / 추가 ${log.feed.addedMl ?? '?'} mL`,
    log.morphology && `형태: ${log.morphology}`,
    log.photos.length > 0 && `사진 ${log.photos.length}장`,
    log.cellsPerMl !== null && `생세포 ${formatCount(log.cellsPerMl)} cells/mL`,
    log.viabilityPct !== null && `생존율 ${log.viabilityPct}%`,
    log.passage?.splitRatio && `분주 ${log.passage.splitRatio}`,
    log.passage?.leftoverHandling && `남은 세포 ${LEFTOVER_LABELS[log.passage.leftoverHandling]}`,
    log.protocolRun?.title,
  ].filter(Boolean);
  return (
    <>
      {facts.length > 0 && <div className="cell-log-facts">{facts.join(' · ')}</div>}
      {(text || !facts.length) && <div className="cell-log-note-text">{text || '—'}</div>}
      {snapshot && <div className="cell-log-facts">사용 조건 스냅샷 기록됨 · 선택한 배양의 기록 목록에서 보기</div>}
      {log.protocolRun && <ProtocolChanges run={log.protocolRun} />}
    </>
  );
}
interface Props {
  line: CellLineDto;
  focusNodeId: string | null;
  onSelectNode(id: string | null): void;
  onChanged(): void;
  externalRevision?: number;
}
export function LineageView(props: Props) {
  return (
    <ReactFlowProvider>
      <LineageInner {...props} />
    </ReactFlowProvider>
  );
}
function LineageInner({ line, focusNodeId, onSelectNode, onChanged, externalRevision = 0 }: Props) {
  const { fitView } = useReactFlow();
  const theme = useResolvedTheme();
  const container = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState<LineageGraph>({ nodes: [], edges: [] });
  const [detail, setDetail] = useState<CellLineDetailDto | null>(null);
  const [logs, setLogs] = useState<CellLineLogDto[]>([]);
  const [hideEnded, setHideEnded] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [filterCulture, setFilterCulture] = useState('');
  const [filterType, setFilterType] = useState('');
  const [dialog, setDialog] = useState<'lot' | 'culture' | null>(null);
  const [editingOperation, setEditingOperation] = useState<string | null>(null);
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
  useEffect(() => {
    if (externalRevision > 0) void load();
  }, [externalRevision, load]);
  const selected =
    focusNodeId ?? detail?.cultures.find((c) => c.status === 'active')?.id ?? detail?.cultures[0]?.id ?? detail?.lots[0]?.id ?? null;
  const visible = useMemo(() => graph.nodes.filter((n) => !hideEnded || n.kind === 'lot' || n.status === 'active'), [graph, hideEnded]);
  const multiPlate = useMemo(
    () => new Map((detail?.cultures ?? []).filter((c) => c.plates.length > 1).map((c) => [c.id, c.plates])),
    [detail],
  );
  // Expanded cultures show each vessel; a passage from chosen vessels then leaves from those vessels.
  const { plateNodes, flowEdges, plateLinks } = useMemo(() => {
    const plateNodes = visible.flatMap((n) =>
      expanded.has(n.id) ? (multiPlate.get(n.id) ?? []).map((p) => ({ id: `${n.id}#${p.no}`, cultureId: n.id, plate: p })) : [],
    );
    const flowEdges = graph.edges.flatMap((e) => {
      if (e.kind !== 'passage' || !e.sourcePlates.length || !expanded.has(e.source)) return [{ edge: e, source: e.source, id: e.id }];
      return e.sourcePlates.map((no) => ({ edge: e, source: `${e.source}#${no}`, id: `${e.id}#${no}` }));
    });
    const plateLinks = plateNodes.map((p) => [p.cultureId, p.id] as [string, string]);
    return { plateNodes, flowEdges, plateLinks };
  }, [visible, multiPlate, expanded, graph.edges]);
  const topology = JSON.stringify([
    [...visible.map((n) => [n.id, 'lineage']), ...plateNodes.map((p) => [p.id, 'plate'])],
    [...flowEdges.map((f) => [f.source, f.edge.target]), ...plateLinks],
  ]);
  const positions = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 80, edgesep: 16 });
    g.setDefaultEdgeLabel(() => ({}));
    const [ids, links] = JSON.parse(topology) as [[string, keyof typeof NODE_SIZE][], [string, string][]];
    const included = new Set(ids.map(([id]) => id));
    // dagre writes x/y into the label object, so each node needs its own copy.
    for (const [id, type] of ids) g.setNode(id, { ...NODE_SIZE[type] });
    for (const [source, target] of links) if (included.has(source) && included.has(target)) g.setEdge(source, target);
    dagre.layout(g);
    return new Map(
      ids.map(([id, type]) => {
        const p = g.node(id) as { x: number; y: number };
        return [id, { x: p.x - NODE_SIZE[type].width / 2, y: p.y - NODE_SIZE[type].height / 2 }];
      }),
    );
  }, [topology]);
  const toggle = useCallback(
    (id: string) =>
      setExpanded((old) => {
        const next = new Set(old);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const nodes = useMemo<FlowNode[]>(
    () => [
      ...visible.map((work): StockNode => {
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
            plates: multiPlate.get(work.id)?.length ?? 1,
            expanded: expanded.has(work.id),
            onToggle: () => toggle(work.id),
          },
        };
      }),
      ...plateNodes.map(
        (p): PlateNode => ({
          id: p.id,
          type: 'plate',
          selected: false,
          position: positions.get(p.id)!,
          data: { cultureId: p.cultureId, no: p.plate.no, status: p.plate.status },
        }),
      ),
    ],
    [visible, plateNodes, detail, selected, positions, multiPlate, expanded, toggle],
  );
  const edges = useMemo<FlowEdge[]>(
    () => [
      ...flowEdges
        .filter((f) => positions.has(f.source) && positions.has(f.edge.target))
        .map(({ edge: e, source, id }) => {
          const name = { thaw: '해동', passage: '계대', freeze: '동결' }[e.kind];
          return {
            id,
            source,
            target: e.target,
            type: 'smoothstep',
            label: e.protocolChanges ? `${name} · 변경 ${e.protocolChanges}` : name,
            className: [e.logId ? 'is-editable' : '', e.protocolChanges ? 'has-protocol-change' : ''].join(' '),
            data: { logId: e.logId },
            interactionWidth: 18,
          };
        }),
      ...plateLinks.map(([source, target]) => ({ id: `plate:${target}`, source, target, type: 'smoothstep', className: 'is-plate-link', data: { logId: null } })),
    ],
    [flowEdges, plateLinks, positions],
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
  // A deleted node (undone thaw/passage/freeze) falls back to the default selection.
  useEffect(() => {
    if (focusNodeId && detail && !detail.lots.some((l) => l.id === focusNodeId) && !detail.cultures.some((c) => c.id === focusNodeId)) onSelectNode(null);
  }, [focusNodeId, detail, onSelectNode]);
  const lot = detail?.lots.find((l) => l.id === selected);
  const culture = detail?.cultures.find((c) => c.id === selected);
  const dialogProps = { line, profiles: detail?.profiles ?? [], onClose: () => setDialog(null), onSaved: changed };
  const ws: LineageWorkspace = { line, profiles: detail?.profiles ?? [], cultures: detail?.cultures ?? [], lots: detail?.lots ?? [], logs };
  const daily = logs.filter(
    (l) =>
      (!filterCulture || l.cultureId === filterCulture) &&
      (!filterType || (filterType === 'thaw' ? l.operation === 'thaw' : l.type === filterType && !(filterType === 'note' && l.operation))),
  );
  const operationLog = logs.find((l) => l.id === editingOperation);
  const operationCulture = detail?.cultures.find((c) => c.id === operationLog?.cultureId);
  return (
    <div className="cell-workspace">
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
              {multiPlate.size > 0 && (
                <>
                  <button className={smallBtnCls} onClick={() => setExpanded(new Set(multiPlate.keys()))}>
                    plate 모두 펼치기
                  </button>
                  <button className={smallBtnCls} disabled={!expanded.size} onClick={() => setExpanded(new Set())}>
                    모두 접기
                  </button>
                </>
              )}
              <button className={smallBtnCls} onClick={() => setDialog('lot')}>
                + stock 입고
              </button>
              <button className={smallBtnCls} onClick={() => setDialog('culture')}>
                + 배양 상태로 입고
              </button>
            </div>
            <div ref={container} className="cell-graph">
              {!loading && !graph.nodes.length && <div className="cell-graph-empty">stock 또는 배양을 입고하여 계보를 시작하세요.</div>}
              <ReactFlow<FlowNode, FlowEdge>
                colorMode={theme}
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                onNodeClick={(_, n) => onSelectNode(n.type === 'plate' ? n.data.cultureId : n.id)}
                onEdgeClick={(_, e) => {
                  if (e.data?.logId) setEditingOperation(e.data.logId);
                }}
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
                {Object.entries({ thaw: '해동', ...logLabels }).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="cell-table-scroll">
              <table className="cell-workspace-table cell-journal-table">
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
                      <td>{recordTitle(l)}</td>
                      <td className="cell-log-note">
                        <JournalNote log={l} />
                      </td>
                      <td>
                        <RecordActions log={l} ws={ws} onChanged={changed} />
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
              ws={ws}
              lot={lot}
              culture={culture}
              onSelect={onSelectNode}
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
                <th>회복 확인</th>
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
                  <td>{l.recovery ? RECOVERY_LABELS[l.recovery.status] : '미기록'}</td>
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
      {operationLog?.operation && operationCulture && (
        <OperationLogDialog log={operationLog} culture={operationCulture} ws={ws} onClose={() => setEditingOperation(null)} onSaved={changed} />
      )}
      {thaw && <ThawDialog line={line} profiles={detail?.profiles ?? []} lot={thaw} onClose={() => setThaw(null)} onSaved={changed} />}
    </div>
  );
}
