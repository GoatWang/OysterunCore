import { TouchEventHandler, useCallback, useEffect, useRef } from 'react';
import type { ItemRange, RemotePaginationEndResult } from '../app/hooks/useVirtualPaginator';

const RESTORE_TOLERANCE_PX = 2;
const RESTORE_VERIFY_DELAY_MS = 80;
const RESTORE_MAX_CORRECTIONS = 12;
const RESTORE_STABLE_CHECKS = 3;

type RemotePaginationAnchor = {
  eventId: string;
  viewportOffset: number;
};

type RemotePaginationTransaction = {
  id: number;
  backwards: boolean;
  anchor: RemotePaginationAnchor | undefined;
  countBeforeFetch: number;
  fetchComplete: boolean;
  materialized: boolean;
  corrections: number;
  stableChecks: number;
  frame: number | undefined;
  timer: number | undefined;
  resolve: (result: RemotePaginationEndResult) => void;
};

type RemotePaginationFetch = (backwards: boolean) => Promise<boolean>;

type IOSRemotePaginationTransactionOptions = {
  enabled: boolean;
  scopeKey: string;
  range: ItemRange;
  count: number;
  getScrollElement: () => HTMLElement | null;
};

type IOSRemotePaginationTransaction = {
  beforeRemoteCommit: () => Promise<void>;
  paginateRemote: (
    backwards: boolean,
    fetchPage: RemotePaginationFetch
  ) => Promise<RemotePaginationEndResult | void>;
  handleTouchStart: TouchEventHandler<HTMLElement>;
  handleTouchEnd: TouchEventHandler<HTMLElement>;
};

const nextAnimationFrame = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

function getViewportAnchor(scrollElement: HTMLElement): RemotePaginationAnchor | undefined {
  const viewportRect = scrollElement.getBoundingClientRect();
  const viewportCenter = viewportRect.top + viewportRect.height / 2;
  let closest:
    | {
        distance: number;
        anchor: RemotePaginationAnchor;
      }
    | undefined;

  scrollElement
    .querySelectorAll<HTMLElement>('[data-message-item][data-message-id]')
    .forEach((element) => {
      const eventId = element.getAttribute('data-message-id');
      if (!eventId) return;
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= viewportRect.top || rect.top >= viewportRect.bottom) return;
      const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
      if (!closest || distance < closest.distance) {
        closest = {
          distance,
          anchor: {
            eventId,
            viewportOffset: rect.top - viewportRect.top,
          },
        };
      }
    });

  return closest?.anchor;
}

function findEventElement(scrollElement: HTMLElement, eventId: string): HTMLElement | undefined {
  return Array.from(
    scrollElement.querySelectorAll<HTMLElement>('[data-message-item][data-message-id]')
  ).find((element) => element.getAttribute('data-message-id') === eventId);
}

function setTransactionProof(
  scrollElement: HTMLElement | null,
  status: 'pending' | 'touch' | 'restoring' | 'verified' | 'blocked',
  transaction?: RemotePaginationTransaction
): void {
  if (!scrollElement) return;
  const proofElement = scrollElement;
  proofElement.dataset.oysterunRoutecIosRemotePagination = status;
  if (!transaction) return;
  proofElement.dataset.oysterunRoutecIosRemotePaginationDirection = transaction.backwards
    ? 'backward'
    : 'forward';
  proofElement.dataset.oysterunRoutecIosRemotePaginationAnchorEventId =
    transaction.anchor?.eventId ?? '';
}

export function useOysterunIOSRemotePaginationTransaction({
  enabled,
  scopeKey,
  range,
  count,
  getScrollElement,
}: IOSRemotePaginationTransactionOptions): IOSRemotePaginationTransaction {
  const touchActiveRef = useRef(false);
  const touchReleaseWaitersRef = useRef(new Set<() => void>());
  const transactionIdRef = useRef(0);
  const transactionRef = useRef<RemotePaginationTransaction>();
  const layoutRef = useRef({ range, count });
  layoutRef.current = { range, count };

  const scheduleRestoreRef = useRef<(delayMs?: number) => void>();

  const clearScheduledRestore = useCallback((transaction: RemotePaginationTransaction) => {
    const currentTransaction = transaction;
    if (currentTransaction.frame !== undefined) {
      window.cancelAnimationFrame(currentTransaction.frame);
      currentTransaction.frame = undefined;
    }
    if (currentTransaction.timer !== undefined) {
      window.clearTimeout(currentTransaction.timer);
      currentTransaction.timer = undefined;
    }
  }, []);

  const finishTransaction = useCallback(
    (transaction: RemotePaginationTransaction, allowAutoFill: boolean) => {
      if (transactionRef.current?.id !== transaction.id) return;
      clearScheduledRestore(transaction);
      transactionRef.current = undefined;
      const scrollElement = getScrollElement();
      setTransactionProof(scrollElement, 'verified', transaction);
      transaction.resolve({
        autoFill:
          allowAutoFill &&
          Boolean(scrollElement && scrollElement.scrollHeight <= scrollElement.clientHeight + 1),
      });
    },
    [clearScheduledRestore, getScrollElement]
  );

  const attemptRestore = useCallback(() => {
    const transaction = transactionRef.current;
    if (!transaction || !transaction.fetchComplete || touchActiveRef.current) return;

    const currentLayout = layoutRef.current;
    const materialized = transaction.backwards
      ? currentLayout.count > transaction.countBeforeFetch && currentLayout.range.start === 0
      : currentLayout.count > transaction.countBeforeFetch &&
        currentLayout.range.end === currentLayout.count;
    if (!materialized) return;
    transaction.materialized = true;

    const scrollElement = getScrollElement();
    if (!scrollElement) {
      finishTransaction(transaction, false);
      return;
    }
    if (!transaction.anchor) {
      finishTransaction(transaction, true);
      return;
    }

    const anchorElement = findEventElement(scrollElement, transaction.anchor.eventId);
    if (!anchorElement) {
      if (transaction.corrections >= RESTORE_MAX_CORRECTIONS) {
        setTransactionProof(scrollElement, 'blocked', transaction);
        return;
      }
      transaction.corrections += 1;
      transaction.stableChecks = 0;
      scheduleRestoreRef.current?.(RESTORE_VERIFY_DELAY_MS);
      return;
    }

    const viewportRect = scrollElement.getBoundingClientRect();
    const currentOffset = anchorElement.getBoundingClientRect().top - viewportRect.top;
    const restoreError = currentOffset - transaction.anchor.viewportOffset;
    if (Math.abs(restoreError) > RESTORE_TOLERANCE_PX) {
      if (transaction.corrections >= RESTORE_MAX_CORRECTIONS) {
        setTransactionProof(scrollElement, 'blocked', transaction);
        return;
      }
      transaction.corrections += 1;
      transaction.stableChecks = 0;
      setTransactionProof(scrollElement, 'restoring', transaction);
      scrollElement.scrollTop += restoreError;
      scheduleRestoreRef.current?.(RESTORE_VERIFY_DELAY_MS);
      return;
    }

    transaction.stableChecks += 1;
    if (transaction.stableChecks < RESTORE_STABLE_CHECKS) {
      scheduleRestoreRef.current?.(RESTORE_VERIFY_DELAY_MS);
      return;
    }
    finishTransaction(transaction, true);
  }, [finishTransaction, getScrollElement]);

  const scheduleRestore = useCallback(
    (delayMs = 0) => {
      const transaction = transactionRef.current;
      if (!transaction) return;
      clearScheduledRestore(transaction);
      if (delayMs > 0) {
        transaction.timer = window.setTimeout(() => {
          transaction.timer = undefined;
          attemptRestore();
        }, delayMs);
        return;
      }
      transaction.frame = window.requestAnimationFrame(() => {
        transaction.frame = undefined;
        attemptRestore();
      });
    },
    [attemptRestore, clearScheduledRestore]
  );
  scheduleRestoreRef.current = scheduleRestore;

  const beforeRemoteCommit = useCallback(async () => {
    if (!enabled || !transactionRef.current) return;
    if (touchActiveRef.current) {
      await new Promise<void>((resolve) => {
        touchReleaseWaitersRef.current.add(resolve);
      });
    }
    await nextAnimationFrame();
    await nextAnimationFrame();
  }, [enabled]);

  const paginateRemote = useCallback(
    async (
      backwards: boolean,
      fetchPage: RemotePaginationFetch
    ): Promise<RemotePaginationEndResult | void> => {
      if (!enabled) {
        await fetchPage(backwards);
        return undefined;
      }
      if (transactionRef.current) return undefined;

      const scrollElement = getScrollElement();
      const transaction: RemotePaginationTransaction = {
        id: transactionIdRef.current + 1,
        backwards,
        anchor: scrollElement ? getViewportAnchor(scrollElement) : undefined,
        countBeforeFetch: layoutRef.current.count,
        fetchComplete: false,
        materialized: false,
        corrections: 0,
        stableChecks: 0,
        frame: undefined,
        timer: undefined,
        resolve: () => undefined,
      };
      transactionIdRef.current = transaction.id;

      return new Promise<RemotePaginationEndResult>((resolve) => {
        transaction.resolve = resolve;
        transactionRef.current = transaction;
        setTransactionProof(scrollElement, 'pending', transaction);
        fetchPage(backwards).then(
          (changed) => {
            if (transactionRef.current?.id !== transaction.id) return;
            if (!changed) {
              finishTransaction(transaction, false);
              return;
            }
            transaction.fetchComplete = true;
            scheduleRestore();
          },
          () => finishTransaction(transaction, false)
        );
      });
    },
    [enabled, finishTransaction, getScrollElement, scheduleRestore]
  );

  const handleTouchStart = useCallback<TouchEventHandler<HTMLElement>>(() => {
    if (!enabled) return;
    touchActiveRef.current = true;
    const transaction = transactionRef.current;
    if (!transaction) return;
    clearScheduledRestore(transaction);
    transaction.corrections = 0;
    transaction.stableChecks = 0;
    setTransactionProof(getScrollElement(), 'touch', transaction);
  }, [clearScheduledRestore, enabled, getScrollElement]);

  const handleTouchEnd = useCallback<TouchEventHandler<HTMLElement>>(() => {
    if (!enabled) return;
    touchActiveRef.current = false;
    touchReleaseWaitersRef.current.forEach((resolve) => resolve());
    touchReleaseWaitersRef.current.clear();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => scheduleRestore()));
  }, [enabled, scheduleRestore]);

  useEffect(() => {
    const transaction = transactionRef.current;
    if (!enabled || !transaction?.fetchComplete) return;
    scheduleRestore();
  }, [count, enabled, range.end, range.start, scheduleRestore]);

  useEffect(
    () => () => {
      touchReleaseWaitersRef.current.forEach((resolve) => resolve());
      touchReleaseWaitersRef.current.clear();
      const transaction = transactionRef.current;
      if (!transaction) return;
      clearScheduledRestore(transaction);
      transactionRef.current = undefined;
      transaction.resolve({ autoFill: false });
    },
    [clearScheduledRestore, enabled, scopeKey]
  );

  return {
    beforeRemoteCommit,
    paginateRemote,
    handleTouchStart,
    handleTouchEnd,
  };
}
