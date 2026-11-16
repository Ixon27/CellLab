import { useCallback, useEffect, useState } from 'react';
import type { CellLineDto, ProfileDto } from '../../shared/cell-line';
import type { CellProtocolDto } from '../../shared/protocol-run';
import { previewSop, type SopPreview } from '../../shared/sop';
import { api } from '../api';

export function useCellProtocols(lineId: string) {
  const [items, setItems] = useState<CellProtocolDto[] | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setError('');
    try {
      setItems(await api<CellProtocolDto[]>(`/api/cell-lines/${lineId}/protocols`));
    } catch (e) {
      setError(e instanceof Error ? e.message : '프로토콜을 불러오지 못했습니다');
    }
  }, [lineId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, error, reload };
}

/** The protocol text as performed: condition variables filled from the condition set. Mirrors the server's protocol-run snapshot. */
export function fillProtocol(body: string, line: CellLineDto, profile: ProfileDto | null): SopPreview {
  return previewSop(body, { name: line.name, max_passage: line.maxPassage }, profile?.fields ?? {});
}
