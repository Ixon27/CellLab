import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { EditorState } from '@tiptap/pm/state';
import { useLocation } from 'wouter';
import { prepareProtocolDocument, protocolDocumentExtensions, serializeProtocolDocument, type PreparedProtocolDocument } from './protocol-document-codec';
import { protocolStepTransaction, type ProtocolStepAction } from './protocol-document-steps';
import './protocol-document.css';

export interface ProtocolDocumentEditorProps {
  value: string;
  onChange(value: string): void;
  cellLineId?: string | null;
}

export function ProtocolDocumentEditor({ value, onChange, cellLineId }: ProtocolDocumentEditorProps) {
  const [, navigate] = useLocation();
  const initial = useRef<PreparedProtocolDocument | null>(null);
  if (!initial.current) initial.current = prepareProtocolDocument(value);
  const [mode, setMode] = useState<'visual' | 'raw'>(initial.current.document ? 'visual' : 'raw');
  const [rawValue, setRawValue] = useState(value);
  const [warning, setWarning] = useState(initial.current.warning);
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<'link' | 'variable' | null>(null);
  const [link, setLink] = useState('');
  const [variable, setVariable] = useState('');
  const current = useRef(value);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [extensions] = useState(protocolDocumentExtensions);
  const callbacks = useRef({ onChange, cellLineId, navigate });
  callbacks.current = { onChange, cellLineId, navigate };

  function openCondition() {
    const context = callbacks.current;
    if (context.cellLineId) context.navigate(`/cells/${encodeURIComponent(context.cellLineId)}?tab=profiles`);
    else setNotice('이 문서는 공용 템플릿입니다. 연결 조건은 세포주를 선택한 뒤 해당 세포주의 배양 조건에서 설정하세요. 템플릿에는 실제 조건값을 넣지 않습니다.');
  }

  const editor = useEditor({
    extensions,
    content: initial.current.document ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'protocol-document-content', role: 'textbox', 'aria-label': '프로토콜 문서 본문', 'aria-multiline': 'true' },
      handleClick(_view, _position, event) {
        if ((event.target as HTMLElement).closest('[data-variable-raw]')) {
          openCondition();
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        keydown(_view, event) {
          if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).closest('[data-variable-raw]')) {
            event.preventDefault();
            openCondition();
            return true;
          }
          return false;
        },
      },
    },
    onUpdate({ editor: updated }) {
      if (modeRef.current !== 'visual') return;
      const next = serializeProtocolDocument(updated.getJSON());
      current.current = next;
      callbacks.current.onChange(next);
    },
  });

  useEffect(() => {
    if (!editor || value === current.current) return;
    // A genuine external replacement (restore/cancel), not our own controlled-value echo.
    const replacement = prepareProtocolDocument(value);
    current.current = value;
    setRawValue(value);
    setWarning(replacement.warning);
    setNotice('');
    setPanel(null);
    const nextMode = replacement.document ? 'visual' : 'raw';
    modeRef.current = nextMode;
    setMode(nextMode);
    // Fresh state also clears undo history: undo must not resurrect a cancelled document.
    editor.view.updateState(EditorState.create({
      schema: editor.schema,
      doc: editor.schema.nodeFromJSON(replacement.document ?? { type: 'doc', content: [{ type: 'paragraph' }] }),
      plugins: editor.state.plugins,
    }));
  }, [editor, value]);

  useEffect(() => { editor?.setEditable(mode === 'visual', false); }, [editor, mode]);

  function switchToVisual() {
    const prepared = prepareProtocolDocument(current.current);
    setWarning(prepared.warning);
    if (!editor || !prepared.document) return;
    editor.view.updateState(EditorState.create({
      schema: editor.schema,
      doc: editor.schema.nodeFromJSON(prepared.document),
      plugins: editor.state.plugins,
    }));
    modeRef.current = 'visual';
    setMode('visual');
    setPanel(null);
    setNotice('문서 편집으로 전환했습니다. 내용을 수정하기 전까지 Markdown 원문은 그대로 유지됩니다.');
  }

  function step(action: ProtocolStepAction) {
    if (!editor) return;
    const transaction = protocolStepTransaction(editor.state, action);
    if (transaction) editor.view.dispatch(transaction);
    else if (action === 'add') editor.chain().focus().insertContent({ type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }).run();
    else setNotice('이동하거나 삭제할 단계의 글 안에 커서를 놓으세요. 첫 단계는 위로, 마지막 단계는 아래로 옮길 수 없습니다.');
    editor.commands.focus();
  }

  const tool = (label: string, action: () => void, options: { active?: boolean; disabled?: boolean; children?: ReactNode } = {}) => (
    <button type="button" className="protocol-document-tool" aria-label={label} title={label}
      aria-pressed={options.active} disabled={!editor || options.disabled}
      onMouseDown={(event) => event.preventDefault()} onClick={action}>
      {options.children ?? label}
    </button>
  );

  return (
    <section className="protocol-document-editor" aria-label="프로토콜 본문 편집기">
      <div className="protocol-document-mode">
        <div className="protocol-document-segment" aria-label="편집 방식">
          <button type="button" aria-pressed={mode === 'visual'} onClick={() => { if (mode !== 'visual') switchToVisual(); }}>문서 편집</button>
          <button type="button" aria-pressed={mode === 'raw'} onClick={() => {
            setRawValue(current.current); modeRef.current = 'raw'; setMode('raw'); setPanel(null); setNotice('');
          }}>고급 · Markdown</button>
        </div>
        <span className="protocol-document-caption">{mode === 'visual' ? '문서를 클릭해 바로 편집하세요' : '원문을 그대로 편집하고 저장합니다'}</span>
      </div>
      {warning && <p className="protocol-document-warning" role="alert">{warning}</p>}
      {notice && <p className="protocol-document-notice" role="status">{notice}</p>}
      {mode === 'raw' && (
        <div className="protocol-document-raw">
          <p>원문은 자동 변환하지 않습니다. ‘문서 편집’을 누르면 내용·구조가 유지되는지 확인한 뒤 전환합니다. 지원하지 않는 문법은 원문에서 계속 편집할 수 있습니다.</p>
          <textarea aria-label="프로토콜 Markdown 원문" spellCheck={false} value={rawValue} onChange={(event) => {
            const next = event.target.value;
            setRawValue(next); current.current = next; setWarning(null); onChange(next);
          }} />
        </div>
      )}
      <div hidden={mode !== 'visual'}>
        <div className="protocol-document-toolbar" role="toolbar" aria-label="문서 서식">
          <div className="protocol-document-toolgroup">
            <select aria-label="문단 스타일" value={editor?.isActive('heading') ? String(editor.getAttributes('heading').level) : 'paragraph'}
              onChange={(event) => {
                if (event.target.value === 'paragraph') editor?.chain().focus().setParagraph().run();
                else editor?.chain().focus().setHeading({ level: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
              }}>
              <option value="paragraph">본문</option>
              <option value="1">제목 1</option><option value="2">제목 2</option><option value="3">제목 3</option>
              <option value="4">제목 4</option><option value="5">제목 5</option><option value="6">제목 6</option>
            </select>
            {tool('굵게', () => { editor?.chain().focus().toggleBold().run(); }, { active: editor?.isActive('bold'), children: <strong>가</strong> })}
            {tool('기울임', () => { editor?.chain().focus().toggleItalic().run(); }, { active: editor?.isActive('italic'), children: <em>가</em> })}
            {tool('글머리 목록', () => { editor?.chain().focus().toggleBulletList().run(); }, { active: editor?.isActive('bulletList') })}
            {tool('번호 목록', () => { editor?.chain().focus().toggleOrderedList().run(); }, { active: editor?.isActive('orderedList') })}
            {tool('주의 문단', () => { editor?.chain().focus().toggleBlockquote().run(); }, { active: editor?.isActive('blockquote') })}
            {tool('링크', () => { setLink(editor?.getAttributes('link').href ?? ''); setPanel(panel === 'link' ? null : 'link'); }, { active: panel === 'link' || editor?.isActive('link') })}
            {tool('조건 변수', () => setPanel(panel === 'variable' ? null : 'variable'), { active: panel === 'variable' })}
          </div>
          <div className="protocol-document-toolgroup">
            {tool('단계 추가', () => step('add'))}
            {tool('단계 위로', () => step('up'), { disabled: !editor || !protocolStepTransaction(editor.state, 'up') })}
            {tool('단계 아래로', () => step('down'), { disabled: !editor || !protocolStepTransaction(editor.state, 'down') })}
            {tool('단계 삭제', () => step('remove'), { disabled: !editor?.isActive('listItem') })}
          </div>
          <div className="protocol-document-toolgroup">
            {tool('표 추가', () => { editor?.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run(); })}
            {tool('행 추가', () => { editor?.chain().focus().addRowAfter().run(); }, { disabled: !editor?.isActive('table') })}
            {tool('열 추가', () => { editor?.chain().focus().addColumnAfter().run(); }, { disabled: !editor?.isActive('table') })}
            {tool('행 삭제', () => { editor?.chain().focus().deleteRow().run(); }, { disabled: !editor?.isActive('table') })}
            {tool('열 삭제', () => { editor?.chain().focus().deleteColumn().run(); }, { disabled: !editor?.isActive('table') })}
            {tool('표 삭제', () => { editor?.chain().focus().deleteTable().run(); }, { disabled: !editor?.isActive('table') })}
          </div>
          <div className="protocol-document-toolgroup">
            {tool('실행 취소', () => { editor?.chain().focus().undo().run(); }, { disabled: !editor?.can().undo() })}
            {tool('다시 실행', () => { editor?.chain().focus().redo().run(); }, { disabled: !editor?.can().redo() })}
          </div>
        </div>
        {panel === 'link' && <form className="protocol-document-insert" onSubmit={(event) => {
          event.preventDefault();
          if (!editor) return;
          if (!link.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
          else if (editor.state.selection.empty && !editor.isActive('link')) editor.chain().focus().insertContent({ type: 'text', text: link.trim(), marks: [{ type: 'link', attrs: { href: link.trim() } }] }).run();
          else editor.chain().focus().extendMarkRange('link').setLink({ href: link.trim() }).run();
          setPanel(null);
        }}>
          <label>링크 주소 <input autoFocus aria-label="링크 주소" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://…" /></label>
          <button type="submit">적용</button><button type="button" onClick={() => { editor?.chain().focus().unsetLink().run(); setPanel(null); }}>링크 해제</button>
        </form>}
        {panel === 'variable' && <form className="protocol-document-insert" onSubmit={(event) => {
          event.preventDefault();
          const key = variable.trim();
          if (!key || /[{}\r\n]/.test(key)) return;
          editor?.chain().focus().insertContent({ type: 'protocolVariable', attrs: { raw: `{{${key}}}`, key } }).run();
          setVariable(''); setPanel(null);
        }}>
          <label>변수 키 <input autoFocus aria-label="조건 변수 키" value={variable} onChange={(event) => setVariable(event.target.value)} placeholder="예: base_medium" /></label>
          <button type="submit" disabled={!variable.trim() || /[{}\r\n]/.test(variable)}>변수 넣기</button>
          <span>실제 값이 아닌 배양 조건 연결을 넣습니다.</span>
        </form>}
        <div className="protocol-document-paper"><EditorContent editor={editor} /></div>
        <p className="protocol-document-footnote">조건 칩은 클릭해서 연결 조건을 확인합니다. 목록 안에서 Tab / Shift+Tab으로 들여쓰기를 조절할 수 있습니다. 문서 수정 후에는 Markdown 서식 표기가 정리될 수 있습니다.</p>
      </div>
    </section>
  );
}
