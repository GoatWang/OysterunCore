import React from 'react';

type OysterunRecoveryState =
  | 'chat_bootstrap_failed'
  | 'clean_chat_room_missing'
  | 'explicit_session_required'
  | 'page_not_found';

type OysterunRecoveryProofAttributes = Record<
  `data-${string}` | 'data-testid',
  string | number | boolean | undefined
>;

type OysterunRecoveryOpenSessionsAction = {
  label?: string;
  testId?: string;
  proofAttributes?: OysterunRecoveryProofAttributes;
};

type OysterunRecoveryRetryAction = {
  label: string;
  onClick: () => void;
  testId: string;
  proofTarget?: string;
  proofAttributes?: OysterunRecoveryProofAttributes;
};

type OysterunRecoveryStartSessionAction = {
  label: string;
  href: string;
  testId: string;
  proofAttributes?: OysterunRecoveryProofAttributes;
};

type OysterunRecoveryPageProps = {
  state: OysterunRecoveryState;
  title: string;
  message: string;
  testId: string;
  proofAttributes?: OysterunRecoveryProofAttributes;
  diagnosticMessage?: string;
  openSessionsAction?: OysterunRecoveryOpenSessionsAction;
  retryAction?: OysterunRecoveryRetryAction;
  startSessionAction?: OysterunRecoveryStartSessionAction;
};

const OPEN_SESSIONS_PATH = '/app/sessions';

export function OysterunRecoveryPage({
  state,
  title,
  message,
  testId,
  proofAttributes,
  diagnosticMessage,
  openSessionsAction,
  retryAction,
  startSessionAction,
}: OysterunRecoveryPageProps) {
  const titleId = `oysterun-recovery-${state}-title`;

  return (
    <main
      {...proofAttributes}
      data-testid={testId}
      data-oysterun-recovery-component="shared"
      data-oysterun-recovery-state={state}
      data-oysterun-recovery-open-sessions-primary="true"
      data-oysterun-recovery-open-sessions-target={OPEN_SESSIONS_PATH}
      data-oysterun-recovery-retry-visible={String(Boolean(retryAction))}
      data-oysterun-recovery-retry-allowed-state={retryAction ? state : undefined}
      data-oysterun-recovery-start-session-visible={String(Boolean(startSessionAction))}
      data-oysterun-recovery-start-session-allowed-state={startSessionAction ? state : undefined}
      data-oysterun-recovery-diagnostic-visible="false"
      data-oysterun-recovery-diagnostic-message={diagnosticMessage}
      data-oysterun-recovery-product-routec-wording="false"
      aria-labelledby={titleId}
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
        background: '#f7f8fb',
        color: '#172033',
      }}
    >
      <section style={{ maxWidth: '560px', width: '100%' }}>
        <p style={{ margin: '0 0 8px', color: '#53617a', fontSize: '14px' }}>Oysterun</p>
        <h1 id={titleId} style={{ margin: '0 0 16px', fontSize: '28px', lineHeight: '36px' }}>
          {title}
        </h1>
        <p style={{ margin: '0 0 24px', color: '#3a465c', fontSize: '16px', lineHeight: '24px' }}>
          {message}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          <a
            {...openSessionsAction?.proofAttributes}
            data-testid={openSessionsAction?.testId ?? 'oysterun-recovery-open-sessions'}
            data-oysterun-recovery-action="open_sessions"
            data-oysterun-recovery-action-kind="primary"
            href={OPEN_SESSIONS_PATH}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: '40px',
              padding: '0 16px',
              borderRadius: '6px',
              background: '#1f5eff',
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            {openSessionsAction?.label ?? 'Open Sessions'}
          </a>
          {retryAction ? (
            <button
              {...retryAction.proofAttributes}
              type="button"
              data-testid={retryAction.testId}
              data-oysterun-recovery-action="retry"
              data-oysterun-recovery-action-kind="secondary"
              data-oysterun-recovery-retry-target={retryAction.proofTarget}
              onClick={retryAction.onClick}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: '40px',
                padding: '0 16px',
                border: 0,
                borderRadius: '6px',
                background: 'transparent',
                color: '#1f5eff',
                font: 'inherit',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {retryAction.label}
            </button>
          ) : null}
          {startSessionAction ? (
            <a
              {...startSessionAction.proofAttributes}
              data-testid={startSessionAction.testId}
              data-oysterun-recovery-action="start_session"
              data-oysterun-recovery-action-kind="secondary"
              href={startSessionAction.href}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: '40px',
                padding: '0 16px',
                borderRadius: '6px',
                color: '#1f5eff',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              {startSessionAction.label}
            </a>
          ) : null}
        </div>
      </section>
    </main>
  );
}
