import { Box } from 'folds';
import React, { ReactNode } from 'react';
import * as css from './SplashScreen.css';

export const ROUTEC_UNIFIED_LOADING_CONTRACT = 'routec-unified-loading-v1';
export const ROUTEC_ORIGINAL_TRANSITION_CONTRACT = 'routec-original-transition-v1';
export const ROUTEC_ORIGINAL_TRANSITION_TITLE = 'Opening Oysterun...';
export const ROUTEC_ORIGINAL_TRANSITION_COPY = 'Loading sessions...';
export const ROUTEC_UNIFIED_LOADING_COPY = ROUTEC_ORIGINAL_TRANSITION_COPY;

type SplashScreenProofAttributes = {
  'data-testid'?: string;
  'data-oysterun-clean-session-testid'?: string;
  'data-oysterun-routec-room-entry-contract'?: string;
  'data-oysterun-clean-session-room-entry-contract'?: string;
  'data-oysterun-routec-room-entry-state'?: string;
  'data-oysterun-clean-session-room-entry-state'?: string;
  'data-oysterun-routec-room-entry-ready'?: string;
  'data-oysterun-clean-session-room-entry-ready'?: string;
  'data-oysterun-routec-room-entry-unready'?: string;
  'data-oysterun-clean-session-room-entry-unready'?: string;
  'data-oysterun-routec-bootstrap-state'?: string;
  'data-oysterun-clean-session-bootstrap-state'?: string;
  'data-oysterun-routec-route-truth'?: string;
  'data-oysterun-clean-session-route-truth'?: string;
  'data-oysterun-routec-session-storage-route-truth'?: string;
  'data-oysterun-clean-session-session-storage-route-truth'?: string;
  'data-oysterun-routec-host-scoped-matrix-session'?: string;
  'data-oysterun-clean-session-host-scoped-matrix-session'?: string;
  'data-oysterun-routec-raw-matrix-login-visible'?: string;
  'data-oysterun-clean-session-raw-matrix-login-visible'?: string;
  'data-oysterun-routec-manual-token-visible'?: string;
  'data-oysterun-clean-session-manual-token-visible'?: string;
  'data-oysterun-routec-homeserver-picker-visible'?: string;
  'data-oysterun-clean-session-homeserver-picker-visible'?: string;
  'data-oysterun-host-session-id'?: string;
  'data-oysterun-room-id'?: string;
  'data-oysterun-routec-composer-send-valid-from-unready'?: string;
  'data-oysterun-clean-session-composer-send-valid-from-unready'?: string;
};

type SplashScreenProps = {
  children?: ReactNode;
  loadingStage?: string;
  loadingSurface?: string;
  proofAttributes?: SplashScreenProofAttributes;
  recoveryVisible?: boolean;
};

export function SplashScreen({
  children,
  loadingStage = 'react_loading',
  loadingSurface = 'web_chat_react',
  proofAttributes,
  recoveryVisible = false,
}: SplashScreenProps) {
  const showOriginalTransitionCard = !children && !recoveryVisible;

  return (
    <Box
      className={css.SplashScreen}
      direction="Column"
      data-oysterun-unified-loading-surface={loadingSurface}
      data-oysterun-loading-contract={ROUTEC_UNIFIED_LOADING_CONTRACT}
      data-oysterun-original-transition-contract={ROUTEC_ORIGINAL_TRANSITION_CONTRACT}
      data-oysterun-original-transition-title={ROUTEC_ORIGINAL_TRANSITION_TITLE}
      data-oysterun-original-transition-copy={ROUTEC_ORIGINAL_TRANSITION_COPY}
      data-oysterun-loading-title={ROUTEC_ORIGINAL_TRANSITION_TITLE}
      data-oysterun-loading-copy={ROUTEC_UNIFIED_LOADING_COPY}
      data-oysterun-loading-stage={loadingStage}
      data-oysterun-loading-recovery-visible={String(recoveryVisible)}
      data-oysterun-loading-error-visible={String(recoveryVisible)}
      data-oysterun-loading-raw-secret-visible="false"
      data-oysterun-loading-host-local-path-visible="false"
      {...proofAttributes}
    >
      {showOriginalTransitionCard ? (
        <Box className={css.OriginalTransitionViewport} grow="Yes">
          <div
            className={css.OriginalTransitionCard}
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <div className={css.OriginalTransitionSpinner} aria-hidden="true" />
            <div className={css.OriginalTransitionPill}>Oysterun</div>
            <h1 className={css.OriginalTransitionTitle}>{ROUTEC_ORIGINAL_TRANSITION_TITLE}</h1>
            <p className={css.OriginalTransitionCopy}>{ROUTEC_ORIGINAL_TRANSITION_COPY}</p>
          </div>
        </Box>
      ) : (
        children
      )}
    </Box>
  );
}
