import type { SourceRef } from '../../shared/cell-line';
import { FIELD_USAGE_LABELS, MEDIUM_PURPOSE_LABELS } from '../../shared/literature';

/** 저장된 출처 근거(원문 문장, 채택 사유, 용도·사용 상태)를 다시 볼 수 있게 보여 준다. */
export function SourceRefDetails({ sourceRef }: { sourceRef: SourceRef }) {
  const badges = [
    sourceRef.usage === 'explicit_not_used' ? FIELD_USAGE_LABELS.explicit_not_used : null,
    sourceRef.purpose && sourceRef.purpose !== 'growth' ? `원문 용도: ${MEDIUM_PURPOSE_LABELS[sourceRef.purpose]}` : null,
    sourceRef.purposeConfirmed ? '용도 다름 확인함' : null,
  ].filter((b): b is string => b !== null);
  return (
    <details className="mt-1 text-fg-muted">
      <summary className="cursor-pointer">
        {sourceRef.sourceLabel || '출처 이름 없음'}
        {badges.map((b) => (
          <span key={b} className="ml-2 rounded bg-sunken px-1 text-xs">
            {b}
          </span>
        ))}
      </summary>
      {sourceRef.reason && (
        <p className="mt-2 text-fg">
          <span className="text-xs text-fg-muted">채택 사유 · </span>
          {sourceRef.reason}
        </p>
      )}
      <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-line pl-3">{sourceRef.quote || '근거 문장 미등록'}</blockquote>
      {sourceRef.evidenceIds && <p className="mt-1 text-xs">근거 id: {sourceRef.evidenceIds.join(', ')}</p>}
      {/^https?:\/\//i.test(sourceRef.url) && (
        <a className="mt-1 inline-block text-accent" href={sourceRef.url} target="_blank" rel="noreferrer">
          원문 열기
        </a>
      )}
    </details>
  );
}
