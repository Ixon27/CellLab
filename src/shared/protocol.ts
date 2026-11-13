export interface ProtocolProvenance {
  kind: 'user_document' | 'lab_photos' | 'ai_draft' | 'imported' | 'manual' | 'cell_copy';
  label: string;
  detail: string;
  copiedFrom?: { id: string; title: string; version: string };
  cellLineId?: string | null;
}

/** Origin describes how a document entered the library, not scientific validation. */
export function protocolProvenance(protocol: { id?: string; source_file?: string | null }): ProtocolProvenance {
  switch (protocol.id) {
    case 'western-blot-v1-1':
      return {
        kind: 'user_document',
        label: '사용자 제공 Word 문서',
        detail: 'Downloads/Western_blot_프로토콜_재료_주의사항_포함_v1.1.docx에서 가져온 초안입니다. 사용자 수정 여부와 별개로 원문 자체가 검증된 표준 지침이라는 뜻은 아닙니다.',
      };
    case 'western-lab-notes':
      return {
        kind: 'lab_photos',
        label: '사용자 제공 실험실 인쇄본 사진 2장',
        detail: '사진을 전사한 초안입니다. 손글씨와 불명확한 표기는 원본 및 실험실 지침과 대조해야 합니다.',
      };
    case 'sop-adherent':
    case 'sop-suspension':
      return {
        kind: 'ai_draft',
        label: 'AI 작성 일반 배양 초안',
        detail: '특정 세포주나 분양처 지침으로 검증하지 않은 일반 골격입니다. 외부 검증 출처가 없으며, 조건을 채워도 세포주별 검증이 완료되는 것은 아닙니다.',
      };
    default:
      return protocol.source_file
        ? { kind: 'imported', label: '사용자 가져오기', detail: `원본 파일: ${protocol.source_file}. 파일 출처와 실험 조건의 적합성은 별도로 확인하세요.` }
        : { kind: 'manual', label: '사용자 직접 작성', detail: '앱에서 직접 만든 문서입니다. 별도의 외부 검증 출처가 등록되어 있지 않습니다.' };
  }
}
