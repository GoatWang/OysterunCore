import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

const SWIFT_PARITY_SWIPE_DISTANCE = 80;
const SWIFT_PARITY_HORIZONTAL_DOMINANCE = 1.5;
const SELECTION_COLLAPSE_DEBOUNCE_MS = 350;
const OYSTERUN_SELECTABLE_MESSAGE_CONTENT_SELECTOR =
  '[data-oysterun-selectable-message-content]';

const SWIPE_BACK_IGNORED_TARGET_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'a',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[data-editable-name]',
  '[data-slate-editor="true"]',
  OYSTERUN_SELECTABLE_MESSAGE_CONTENT_SELECTOR,
  '[data-oysterun-swipe-back-ignore]',
].join(',');

const SWIPE_BACK_ACTIVE_BLOCKER_SELECTOR = [
  '[aria-modal="true"]',
  '[role="dialog"]',
  '[role="menu"]',
  '[data-oysterun-swipe-back-blocker]',
].join(',');

type SwipeState = {
  pointerId: number;
  startX: number;
  startY: number;
  fired: boolean;
};

type OysterunCapacitorSwipeBackOptions = {
  enabled: boolean;
  onBack: () => void;
};

function isOysterunCapacitorIOS(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

function isElementTarget(target: EventTarget | null): target is Element {
  return target instanceof Element;
}

function shouldIgnoreSwipeStart(target: EventTarget | null): boolean {
  if (!isElementTarget(target)) return true;
  if (target.closest(SWIPE_BACK_IGNORED_TARGET_SELECTOR)) return true;
  return Boolean(document.querySelector(SWIPE_BACK_ACTIVE_BLOCKER_SELECTOR));
}

function hasActiveWindowSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed);
}

export function useOysterunCapacitorSwipeBack({
  enabled,
  onBack,
}: OysterunCapacitorSwipeBackOptions): void {
  const onBackRef = useRef(onBack);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!enabled || !isOysterunCapacitorIOS()) return undefined;

    let swipeState: SwipeState | undefined;
    let selectionWasActive = false;
    let selectionSuppressedUntilMs = 0;

    const resetSwipe = () => {
      swipeState = undefined;
    };

    const shouldSuppressForSelection = () => {
      if (hasActiveWindowSelection()) {
        selectionWasActive = true;
        return true;
      }
      return Date.now() < selectionSuppressedUntilMs;
    };

    const handleSelectionChange = () => {
      if (hasActiveWindowSelection()) {
        selectionWasActive = true;
        resetSwipe();
        return;
      }

      if (selectionWasActive) {
        selectionWasActive = false;
        selectionSuppressedUntilMs = Date.now() + SELECTION_COLLAPSE_DEBOUNCE_MS;
        resetSwipe();
      }
    };

    const handlePointerDown = (evt: PointerEvent) => {
      if (!evt.isPrimary || shouldIgnoreSwipeStart(evt.target) || shouldSuppressForSelection()) {
        resetSwipe();
        return;
      }
      swipeState = {
        pointerId: evt.pointerId,
        startX: evt.clientX,
        startY: evt.clientY,
        fired: false,
      };
    };

    const handlePointerMove = (evt: PointerEvent) => {
      if (!swipeState || swipeState.pointerId !== evt.pointerId || swipeState.fired) return;
      if (shouldSuppressForSelection()) {
        resetSwipe();
        return;
      }

      const deltaX = evt.clientX - swipeState.startX;
      const deltaY = evt.clientY - swipeState.startY;
      if (
        deltaX > SWIFT_PARITY_SWIPE_DISTANCE &&
        Math.abs(deltaX) > Math.abs(deltaY) * SWIFT_PARITY_HORIZONTAL_DOMINANCE
      ) {
        swipeState.fired = true;
        onBackRef.current();
      }
    };

    const listenerOptions: AddEventListenerOptions = {
      capture: true,
      passive: true,
    };

    window.addEventListener('pointerdown', handlePointerDown, listenerOptions);
    window.addEventListener('pointermove', handlePointerMove, listenerOptions);
    window.addEventListener('pointerup', resetSwipe, listenerOptions);
    window.addEventListener('pointercancel', resetSwipe, listenerOptions);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, listenerOptions);
      window.removeEventListener('pointermove', handlePointerMove, listenerOptions);
      window.removeEventListener('pointerup', resetSwipe, listenerOptions);
      window.removeEventListener('pointercancel', resetSwipe, listenerOptions);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [enabled]);
}
