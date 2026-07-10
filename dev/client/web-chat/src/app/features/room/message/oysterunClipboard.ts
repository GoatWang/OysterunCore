type ClipboardAccessReason = 'unavailable' | 'insecure-context' | 'gesture-expired';

type ClipboardAccessError = Error & {
  code: ClipboardAccessReason;
  cause?: unknown;
};

const CLIPBOARD_LOG_PREFIX = '[oysterun-routec]';

export const OYSTERUN_ROUTE_C_CLIPBOARD_HELPER_ID = 'routec_browser_clipboard_v1';
export const OYSTERUN_ROUTE_C_CLIPBOARD_ROOT_SELECTOR =
  '[data-oysterun-routec-copy-root="message-menu"]';

export type OysterunRouteCClipboardWriteOptions = {
  copyRoot?: HTMLElement | null;
};

const isIosClipboardBrowser = (): boolean =>
  /ipad|iphone|ipod/i.test(navigator.userAgent || '') ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isSecureClipboardApiAvailable = (): boolean =>
  window.isSecureContext === true &&
  Boolean(navigator.clipboard) &&
  (typeof navigator.clipboard.write === 'function' ||
    typeof navigator.clipboard.writeText === 'function');

const createClipboardAccessError = (
  reason: ClipboardAccessReason = 'unavailable',
  originalError?: unknown
): ClipboardAccessError => {
  let message = 'Clipboard access is unavailable in this browser';
  if (reason === 'insecure-context') {
    message =
      'Clipboard API is unavailable on non-HTTPS pages in this browser. Use a direct copy action from the message menu.';
  } else if (reason === 'gesture-expired') {
    message =
      'Clipboard write was blocked by the browser. Try again directly from the message menu.';
  }

  const err = new Error(message) as ClipboardAccessError;
  err.code = reason;
  if (originalError) {
    err.cause = originalError;
  }
  return err;
};

const classifyClipboardError = (err?: unknown): ClipboardAccessReason => {
  if (window.isSecureContext !== true) {
    return 'insecure-context';
  }
  if (err instanceof Error) {
    const errorName = String(err.name || '');
    const errorMessage = String(err.message || '');
    if (
      errorName === 'NotAllowedError' ||
      /notallowed|gesture|user gesture|denied|permission/i.test(errorMessage)
    ) {
      return 'gesture-expired';
    }
  }
  return 'unavailable';
};

const getFocusTrapSafeClipboardHost = (copyRoot: HTMLElement | null | undefined): HTMLElement => {
  if (copyRoot?.isConnected) return copyRoot;

  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const activeCopyRoot = activeElement?.closest<HTMLElement>(
    OYSTERUN_ROUTE_C_CLIPBOARD_ROOT_SELECTOR
  );
  if (activeCopyRoot?.isConnected) return activeCopyRoot;

  if (document.body) return document.body;
  throw createClipboardAccessError('unavailable');
};

const copyTextToClipboardSynchronously = (
  text: string,
  options: OysterunRouteCClipboardWriteOptions = {}
): void => {
  const value = String(text ?? '');
  let textarea: HTMLTextAreaElement | null = null;
  let selection: Selection | null = null;
  let savedRanges: Range[] = [];
  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  try {
    if (typeof document.createElement !== 'function') {
      throw createClipboardAccessError('unavailable');
    }

    const clipboardHost = getFocusTrapSafeClipboardHost(options.copyRoot);
    const selectionEnd = value.length;
    textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('autocomplete', 'off');
    textarea.setAttribute('autocorrect', 'off');
    textarea.setAttribute('data-oysterun-routec-copy-buffer', 'true');
    textarea.spellcheck = false;
    textarea.tabIndex = -1;
    textarea.readOnly = false;
    textarea.contentEditable = 'true';
    textarea.style.position = 'fixed';
    textarea.style.top = '8px';
    textarea.style.left = '8px';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.opacity = '0.01';
    textarea.style.pointerEvents = 'none';
    textarea.style.zIndex = '-1';
    textarea.style.fontSize = '16px';
    textarea.style.padding = '0';
    textarea.style.border = '0';
    textarea.style.outline = '0';
    textarea.style.background = 'transparent';
    textarea.style.color = 'transparent';
    textarea.style.webkitUserSelect = 'text';

    selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
    if (selection) {
      for (let index = 0; index < selection.rangeCount; index += 1) {
        savedRanges.push(selection.getRangeAt(index).cloneRange());
      }
    }

    clipboardHost.appendChild(textarea);
    try {
      textarea.focus({ preventScroll: true });
    } catch {
      textarea.focus();
    }

    textarea.select();
    textarea.setSelectionRange(0, selectionEnd);
    if (isIosClipboardBrowser() && selection && typeof document.createRange === 'function') {
      const range = document.createRange();
      range.selectNodeContents(textarea);
      selection.removeAllRanges();
      selection.addRange(range);
      textarea.setSelectionRange(0, selectionEnd);
    }

    const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    if (!copied) {
      throw createClipboardAccessError(classifyClipboardError());
    }
  } finally {
    if (textarea?.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
    if (selection) {
      selection.removeAllRanges();
      savedRanges.forEach((range) => {
        selection?.addRange(range);
      });
    }
    savedRanges = [];
    if (activeElement) {
      try {
        activeElement.focus({ preventScroll: true });
      } catch {
        activeElement.focus();
      }
    }
  }
};

export const writeOysterunRouteCMessageTextToClipboard = async (
  text: string,
  options: OysterunRouteCClipboardWriteOptions = {}
): Promise<void> => {
  const value = String(text ?? '');
  let lastError: unknown;

  try {
    copyTextToClipboardSynchronously(value, options);
    return;
  } catch (err) {
    lastError = err;
    console.warn(
      `${CLIPBOARD_LOG_PREFIX} synchronous Copy Message clipboard write failed; falling back to async APIs when available`,
      err
    );
  }
  if (!isSecureClipboardApiAvailable()) {
    throw createClipboardAccessError(classifyClipboardError(lastError), lastError);
  }

  if (
    isSecureClipboardApiAvailable() &&
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator.clipboard.write === 'function'
  ) {
    try {
      const blob = new Blob([value], { type: 'text/plain' });
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return;
    } catch (err) {
      lastError = err;
      console.warn(
        `${CLIPBOARD_LOG_PREFIX} navigator.clipboard.write failed; falling back to writeText`,
        err
      );
    }
  }

  if (isSecureClipboardApiAvailable() && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (err) {
      lastError = err;
      console.warn(
        `${CLIPBOARD_LOG_PREFIX} navigator.clipboard.writeText failed; falling back to execCommand copy`,
        err
      );
    }
  }

  try {
    copyTextToClipboardSynchronously(value, options);
    return;
  } catch (err) {
    lastError = err;
  }

  throw createClipboardAccessError(classifyClipboardError(lastError), lastError);
};
