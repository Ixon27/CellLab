import { Fragment } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';

export type ProtocolStepAction = 'add' | 'up' | 'down' | 'remove';

/** Operate on the nearest list item, preserving all of its nested content and marks. */
export function protocolStepTransaction(state: EditorState, action: ProtocolStepAction): Transaction | null {
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && $from.node(depth).type.name !== 'listItem') depth--;
  if (!depth) return null;
  const list = $from.node(depth - 1);
  if (list.type.name !== 'orderedList' && list.type.name !== 'bulletList') return null;
  const index = $from.index(depth - 1);
  const position = $from.before(depth);
  const item = $from.node(depth);
  const tr = state.tr;
  if (action === 'add') {
    const empty = state.schema.nodes.listItem.createAndFill();
    if (!empty) return null;
    const at = position + item.nodeSize;
    tr.insert(at, empty);
    return tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2))).scrollIntoView();
  }
  if (action === 'remove') {
    if (list.childCount === 1) {
      const listPosition = $from.before(depth - 1);
      tr.replaceWith(listPosition, listPosition + list.nodeSize, state.schema.nodes.paragraph.create());
      return tr.setSelection(TextSelection.near(tr.doc.resolve(listPosition + 1))).scrollIntoView();
    }
    tr.delete(position, position + item.nodeSize);
    return tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(position, tr.doc.content.size)))).scrollIntoView();
  }
  const adjacentIndex = index + (action === 'up' ? -1 : 1);
  if (adjacentIndex < 0 || adjacentIndex >= list.childCount) return null;
  const adjacent = list.child(adjacentIndex);
  const start = action === 'up' ? position - adjacent.nodeSize : position;
  const nodes = action === 'up' ? [item, adjacent] : [adjacent, item];
  tr.replaceWith(start, start + item.nodeSize + adjacent.nodeSize, Fragment.fromArray(nodes));
  const nextPosition = action === 'up' ? start : start + adjacent.nodeSize;
  const cursorOffset = $from.pos - position;
  return tr.setSelection(TextSelection.near(tr.doc.resolve(nextPosition + cursorOffset))).scrollIntoView();
}
