import { protocolProvenance } from '../../shared/protocol';
import type { ProtocolProvenance } from '../../shared/protocol';
import { previewSop } from '../../shared/sop';
import { Markdown } from './Markdown';

export interface ReadonlyProtocol {
  body_md: string;
  id?: string;
  source_file?: string | null;
  provenance?: ProtocolProvenance;
}

export function ProtocolOrigin({ protocol }: { protocol: Omit<ReadonlyProtocol, 'body_md'> }) {
  const origin = protocol.provenance ?? protocolProvenance(protocol);
  return (
    <aside className="rounded-xl border border-line bg-raised p-4 text-sm text-fg-muted">
      <p className="font-medium text-fg">출처 · {origin.label}</p>
      <p className="mt-1 leading-relaxed">{origin.detail}</p>
      {origin.copiedFrom && (
        <p className="mt-1">
          복사 기준: {origin.copiedFrom.title} · {origin.copiedFrom.version || '버전 없음'}
        </p>
      )}
    </aside>
  );
}

/** For protocol-only readonly surfaces, never a blanket Markdown replacement. */
export function ProtocolPreview({ protocol }: { protocol: ReadonlyProtocol }) {
  const preview = previewSop(protocol.body_md);
  return (
    <div className="min-w-0 space-y-4">
      <ProtocolOrigin protocol={protocol} />
      {preview.missingFields.length > 0 && (
        <p className="text-sm leading-relaxed text-fg-muted">
          템플릿 미리보기입니다. 변수는 읽기 쉬운 미설정 항목으로 표시하며, 원본 변수는 편집·저장 시 유지됩니다. 세포주별 값은 해당 세포주의
          배양 SOP에서 확인하세요.
        </p>
      )}
      <Markdown text={preview.markdown} />
    </div>
  );
}
