import {
  BaseRange,
  Editor,
  Node as SlateNode,
  Range as SlateRange,
  Text as SlateText,
  Transforms,
} from 'slate';
import { ReactEditor } from 'slate-react';

export const OYSTERUN_P020_COMPOSITION_DELETION_ZWS = '\u200b';

type NavigatorIdentity = Pick<Navigator, 'maxTouchPoints' | 'platform' | 'userAgent'>;

export type OysterunCompositionSelectionResult =
  | 'not-focused'
  | 'current'
  | 'dom'
  | 'current-reasserted'
  | 'last-valid'
  | 'editor-end'
  | 'unresolved';

const clonePoint = (point: BaseRange['anchor']): BaseRange['anchor'] => ({
  path: [...point.path],
  offset: point.offset,
});

export const cloneOysterunSlateRange = (range: BaseRange): BaseRange => ({
  anchor: clonePoint(range.anchor),
  focus: clonePoint(range.focus),
});

const isValidSlatePoint = (editor: Editor, point: BaseRange['anchor']): boolean => {
  if (!SlateNode.has(editor, point.path)) return false;
  const node = SlateNode.get(editor, point.path);
  return SlateText.isText(node) && point.offset >= 0 && point.offset <= node.text.length;
};

export const isOysterunSlateRangeValid = (
  editor: Editor,
  range: BaseRange | null | undefined
): range is BaseRange => {
  if (!range || !SlateRange.isRange(range)) return false;
  return isValidSlatePoint(editor, range.anchor) && isValidSlatePoint(editor, range.focus);
};

export const isOysterunAppleWebKitIME = (
  identity: NavigatorIdentity = window.navigator
): boolean => {
  const { maxTouchPoints, platform, userAgent } = identity;
  const appleMobile =
    /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  const desktopSafari =
    /Macintosh/i.test(userAgent) &&
    /Safari/i.test(userAgent) &&
    !/Chrome|Chromium|CriOS|Edg|FxiOS|OPR/i.test(userAgent);
  return appleMobile || desktopSafari;
};

const isDOMText = (node: globalThis.Node | null): node is globalThis.Text => node?.nodeType === 3;

export const protectOysterunCompositionDeletion = (
  event: InputEvent,
  selection: Selection | null = window.getSelection()
): globalThis.Text | null => {
  if (event.inputType !== 'deleteCompositionText' || !selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const { endContainer, endOffset, startContainer, startOffset } = range;
  if (
    !isDOMText(startContainer) ||
    startContainer !== endContainer ||
    startOffset !== 0 ||
    endOffset !== startContainer.length ||
    !startContainer.parentElement
  ) {
    return null;
  }

  const { target } = event;
  if (target instanceof HTMLElement && !target.contains(startContainer.parentElement)) {
    return null;
  }

  const protectionNode = startContainer.ownerDocument.createTextNode(
    OYSTERUN_P020_COMPOSITION_DELETION_ZWS
  );
  startContainer.parentElement.insertBefore(protectionNode, startContainer);
  return protectionNode;
};

export const cleanupOysterunCompositionDeletion = (
  protectionNode: globalThis.Text | null | undefined
): void => {
  if (protectionNode?.parentNode) protectionNode.remove();
};

const getFocusedEditorElement = (editor: Editor): HTMLElement | null => {
  try {
    const editorElement = ReactEditor.toDOMNode(editor, editor);
    const { activeElement } = editorElement.ownerDocument;
    if (activeElement !== editorElement && !editorElement.contains(activeElement)) return null;
    return editorElement;
  } catch {
    return null;
  }
};

const getOysterunDOMSlateRange = (editor: Editor): BaseRange | null => {
  const editorElement = getFocusedEditorElement(editor);
  if (!editorElement) return null;

  const selection = editorElement.ownerDocument.getSelection();
  if (
    !selection ||
    selection.rangeCount === 0 ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !ReactEditor.hasDOMNode(editor, selection.anchorNode, { editable: true }) ||
    !ReactEditor.hasDOMNode(editor, selection.focusNode, { editable: true })
  ) {
    return null;
  }

  const slateRange = ReactEditor.toSlateRange(editor, selection, {
    exactMatch: false,
    suppressThrow: true,
  });
  return isOysterunSlateRangeValid(editor, slateRange) ? slateRange : null;
};

const applyOysterunSlateSelection = (editor: Editor, range: BaseRange): void => {
  if (editor.selection) Transforms.deselect(editor);
  Transforms.select(editor, range);
};

export const reconcileOysterunCompositionSelection = (
  editor: Editor,
  lastValidSelection: BaseRange | null
): OysterunCompositionSelectionResult => {
  if (!getFocusedEditorElement(editor)) return 'not-focused';

  const currentSelection = isOysterunSlateRangeValid(editor, editor.selection)
    ? cloneOysterunSlateRange(editor.selection)
    : null;
  const domSelection = getOysterunDOMSlateRange(editor);

  if (currentSelection && domSelection && SlateRange.equals(currentSelection, domSelection)) {
    return 'current';
  }

  if (domSelection) {
    applyOysterunSlateSelection(editor, domSelection);
    return 'dom';
  }

  if (currentSelection) {
    applyOysterunSlateSelection(editor, currentSelection);
    return 'current-reasserted';
  }

  if (isOysterunSlateRangeValid(editor, lastValidSelection)) {
    applyOysterunSlateSelection(editor, lastValidSelection);
    return 'last-valid';
  }

  try {
    const end = Editor.end(editor, []);
    applyOysterunSlateSelection(editor, { anchor: end, focus: end });
    return 'editor-end';
  } catch {
    return 'unresolved';
  }
};
