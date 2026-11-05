export interface DesktopInfo {
  version: string;
  dataDir: string;
  filesDir: string;
  logDir: string;
}

export const IPC = {
  getInfo: 'cell-lab:get-info',
  getTheme: 'cell-lab:get-theme',
  openSettings: 'cell-lab:open-settings',
  reveal: 'cell-lab:reveal',
  setTheme: 'cell-lab:set-theme',
} as const;

/** What the backend may ask the Electron main process to do; main owns the system browser. */
export type BridgeOp = { op: 'openExternal'; url: string };
export type BridgeRequest = { type: 'bridge'; id: number } & BridgeOp;
export type BridgeResult = { type: 'bridgeResult'; id: number; ok: boolean; value?: string | null; error?: string };

export type ParentMessage = { type: 'shutdown' } | { type: 'start'; token: string } | BridgeResult;
export type BackendMessage = { type: 'ready'; port: number } | { type: 'fatal'; message: string } | BridgeRequest;

const isBridgeId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

export type ParsedBridgeRequest = { ok: true; request: BridgeRequest } | { ok: false; id: number | null; error: string };

/** Validates an untrusted `bridge` message; `id` is kept when present so the caller can still answer. */
export function parseBridgeRequest(message: unknown): ParsedBridgeRequest {
  const m = (typeof message === 'object' && message !== null ? message : {}) as Record<string, unknown>;
  const id = isBridgeId(m.id) ? m.id : null;
  if (m.type !== 'bridge' || id === null) return { ok: false, id, error: '잘못된 데스크톱 요청입니다' };
  switch (m.op) {
    case 'openExternal':
      if (typeof m.url === 'string') return { ok: true, request: { type: 'bridge', id, op: 'openExternal', url: m.url } };
      break;
    default:
      return { ok: false, id, error: '알 수 없는 데스크톱 요청입니다' };
  }
  return { ok: false, id, error: '잘못된 데스크톱 요청입니다' };
}
