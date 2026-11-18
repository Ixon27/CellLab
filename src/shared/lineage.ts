import type { CultureDto, LogDto, LotDto } from './cell-line';

export interface LineageNode {
  id: string;
  kind: 'lot' | 'culture';
  label: string;
  passage: number | null;
  status: string;
  vialsRemaining?: number;
  lastConfluency?: number | null;
  /** Ordinary records of this culture that changed protocol steps for that run (thaw/passage/freeze changes sit on edges). */
  protocolChangedRecords?: number;
  startedAt: string;
}
export interface LineageEdge {
  id: string;
  source: string;
  target: string;
  kind: 'thaw' | 'passage' | 'freeze';
  /** The record of the operation that drew this edge; null for legacy lineage without one. */
  logId: string | null;
  /** Protocol steps changed in that operation's run. */
  protocolChanges: number;
  /** For a passage from a culture of several vessels: the vessels (1-based) the cells came from; empty = the culture. */
  sourcePlates: number[];
}
export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}
/** Operation records keyed by edge id (`kind:source:target`), and per-culture counts of ordinary records with step changes. */
export interface LineageAnnotations {
  operations: Record<string, { logId: string; protocolChanges: number; sourcePlates?: number[] }>;
  changedRecords: Record<string, number>;
}

export function buildLineageGraph(
  lots: LotDto[],
  cultures: CultureDto[],
  lastLogs: Record<string, LogDto>,
  annotations: LineageAnnotations = { operations: {}, changedRecords: {} },
): LineageGraph {
  const nodes: LineageNode[] = [
    ...lots.map((l) => ({
      id: l.id,
      kind: 'lot' as const,
      label: l.label,
      passage: l.passage,
      status: l.origin,
      vialsRemaining: l.vialsRemaining,
      startedAt: l.eventAt,
    })),
    ...cultures.map((c) => ({
      id: c.id,
      kind: 'culture' as const,
      label: c.label,
      passage: c.passage,
      status: c.status,
      lastConfluency: lastLogs[c.id]?.confluencyPct ?? null,
      protocolChangedRecords: annotations.changedRecords[c.id] ?? 0,
      startedAt: c.startedAt,
    })),
  ];
  const ids = new Set(nodes.map((n) => n.id));
  const edges: LineageEdge[] = [];
  const add = (source: string | null, target: string, kind: LineageEdge['kind']) => {
    if (!source || !ids.has(source)) return;
    const id = `${kind}:${source}:${target}`;
    const op = annotations.operations[id];
    edges.push({ id, source, target, kind, logId: op?.logId ?? null, protocolChanges: op?.protocolChanges ?? 0, sourcePlates: op?.sourcePlates ?? [] });
  };
  for (const c of cultures) {
    add(c.parentLotId, c.id, 'thaw');
    add(c.parentCultureId, c.id, 'passage');
  }
  for (const l of lots) add(l.sourceCultureId, l.id, 'freeze');
  return { nodes, edges };
}
