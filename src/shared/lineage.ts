import type { CultureDto, LogDto, LotDto } from './cell-line';

export interface LineageNode { id: string; kind: 'lot' | 'culture'; label: string; passage: number | null; status: string; vialsRemaining?: number; lastConfluency?: number | null; startedAt: string }
export interface LineageEdge { id: string; source: string; target: string; kind: 'thaw' | 'passage' | 'freeze' }
export interface LineageGraph { nodes: LineageNode[]; edges: LineageEdge[] }

export function buildLineageGraph(lots: LotDto[], cultures: CultureDto[], lastLogs: Record<string, LogDto>): LineageGraph {
  const nodes: LineageNode[] = [
    ...lots.map(l => ({ id: l.id, kind: 'lot' as const, label: l.label, passage: l.passage, status: l.origin, vialsRemaining: l.vialsRemaining, startedAt: l.eventAt })),
    ...cultures.map(c => ({ id: c.id, kind: 'culture' as const, label: c.label, passage: c.passage, status: c.status, lastConfluency: lastLogs[c.id]?.confluencyPct ?? null, startedAt: c.startedAt })),
  ];
  const ids = new Set(nodes.map(n => n.id));
  const edges: LineageEdge[] = [];
  const add = (source: string | null, target: string, kind: LineageEdge['kind']) => { if (source && ids.has(source)) edges.push({ id: `${kind}:${source}:${target}`, source, target, kind }); };
  for (const c of cultures) { add(c.parentLotId, c.id, 'thaw'); add(c.parentCultureId, c.id, 'passage'); }
  for (const l of lots) add(l.sourceCultureId, l.id, 'freeze');
  return { nodes, edges };
}
