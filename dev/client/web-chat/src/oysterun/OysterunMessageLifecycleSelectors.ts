import type {
  OysterunHost2IntakeProof,
  OysterunHostSessionSnapshotResponse,
  OysterunRouteCOptimisticProviderRespondingEvent,
  OysterunRouteCProviderLifecycle,
} from './OysterunHostClient';

const OYSTERUN_OPEN_OUTBOX_STATES = new Set(['queued', 'dispatching', 'running']);
const OYSTERUN_TERMINAL_OUTBOX_STATES = new Set([
  'completed',
  'failed',
  'interrupted',
  'canceled',
  'ambiguous',
  'stalled',
]);
const OYSTERUN_ROUTE_C_OPTIMISTIC_RESPONDING_TTL_MS = 30000;

export type OysterunMessageLifecycleSemanticActivity = {
  sourceUserEventId: string;
  displayName: string;
  semanticActiveAfterUser: boolean;
  fallbackFinalResultForSource: boolean;
  latestSemanticType?: string;
};

export type OysterunMessageLifecycleRawStatus = {
  roomId: string;
  sessionId?: string;
  snapshot?: OysterunHostSessionSnapshotResponse;
  providerLifecycle?: OysterunRouteCProviderLifecycle;
  optimistic?: OysterunRouteCOptimisticProviderRespondingEvent;
  semanticActivity?: OysterunMessageLifecycleSemanticActivity;
  transientFailureCount?: number;
};

export type OysterunRouteCRespondingState = {
  rawLifecycle: OysterunMessageLifecycleRawStatus;
  agentResponding: boolean;
  displayName?: string;
  sourceUserEventId?: string;
  host2IntakeState?: string;
  agentTurnStarted?: boolean;
  providerDeliveryClaimed?: boolean;
  finalResultForSource?: boolean;
  outboxMessageState?: string;
  outboxDeliveryState?: string;
  outboxActiveMessageState?: string | null;
  promptOpenSource?: string;
  latestSemanticType?: string;
  providerLifecycleSource?: string;
  providerLifecycleState?: string;
  providerLifecycleActive?: boolean;
  providerLifecycleTerminal?: boolean;
  relatedPollingAllowed: boolean;
  canonicalLifecycleKnown: boolean;
  optimisticClientRequestId?: string;
  pendingControlRequestCount?: number;
};

export type OysterunHost2CancelControlState = {
  status: 'ready' | 'canceling' | 'accepted' | 'too_late' | 'error' | 'hidden';
  proof: OysterunHost2IntakeProof;
  error?: string;
};

export function isOysterunProviderLifecycleActive(
  lifecycle: OysterunRouteCProviderLifecycle | undefined
): boolean {
  if (!lifecycle) return false;
  if (lifecycle.active === true) return true;
  return OYSTERUN_OPEN_OUTBOX_STATES.has(lifecycle.state);
}

export function isOysterunProviderLifecycleTerminal(
  lifecycle: OysterunRouteCProviderLifecycle | undefined
): boolean {
  if (!lifecycle) return false;
  if (lifecycle.terminal === true) return true;
  return OYSTERUN_TERMINAL_OUTBOX_STATES.has(lifecycle.state);
}

export function selectIsTerminal(rawLifecycle: OysterunMessageLifecycleRawStatus): boolean {
  return isOysterunProviderLifecycleTerminal(rawLifecycle.providerLifecycle);
}

export function isOysterunOptimisticRespondingActive(
  rawLifecycle: OysterunMessageLifecycleRawStatus,
  nowMs = Date.now()
): boolean {
  const optimistic = rawLifecycle.optimistic;
  if (!optimistic || optimistic.status !== 'accepted') return false;
  if (optimistic.roomId !== rawLifecycle.roomId) return false;
  if (
    optimistic.sessionId &&
    rawLifecycle.sessionId &&
    optimistic.sessionId !== rawLifecycle.sessionId
  ) {
    return false;
  }
  if (isOysterunProviderLifecycleActive(rawLifecycle.providerLifecycle)) return false;
  if (isOysterunProviderLifecycleTerminal(rawLifecycle.providerLifecycle)) return false;
  return nowMs - optimistic.createdAt <= OYSTERUN_ROUTE_C_OPTIMISTIC_RESPONDING_TTL_MS;
}

export function selectSemanticFallbackActive(
  rawLifecycle: OysterunMessageLifecycleRawStatus,
  nowMs = Date.now()
): boolean {
  return (
    !rawLifecycle.providerLifecycle &&
    !isOysterunOptimisticRespondingActive(rawLifecycle, nowMs) &&
    rawLifecycle.semanticActivity?.semanticActiveAfterUser === true &&
    rawLifecycle.semanticActivity.fallbackFinalResultForSource !== true
  );
}

export function selectIsResponding(
  rawLifecycle: OysterunMessageLifecycleRawStatus,
  nowMs = Date.now()
): boolean {
  return (
    isOysterunProviderLifecycleActive(rawLifecycle.providerLifecycle) ||
    isOysterunOptimisticRespondingActive(rawLifecycle, nowMs) ||
    selectSemanticFallbackActive(rawLifecycle, nowMs)
  );
}

export function selectIsCancelable(rawLifecycle: OysterunMessageLifecycleRawStatus): boolean {
  return (
    rawLifecycle.providerLifecycle?.cancelable === true &&
    !isOysterunProviderLifecycleTerminal(rawLifecycle.providerLifecycle)
  );
}

export function selectCanStop(rawLifecycle: OysterunMessageLifecycleRawStatus): boolean {
  return selectIsResponding(rawLifecycle) && !selectIsTerminal(rawLifecycle);
}

export function selectComposerPrimaryAction(
  rawLifecycle: OysterunMessageLifecycleRawStatus,
  composerText: string
): 'interrupt' | 'send' {
  return selectCanStop(rawLifecycle) && composerText.length === 0 ? 'interrupt' : 'send';
}

export function selectPollingNeeded(rawLifecycle: OysterunMessageLifecycleRawStatus): boolean {
  return (
    isOysterunProviderLifecycleActive(rawLifecycle.providerLifecycle) ||
    isOysterunOptimisticRespondingActive(rawLifecycle) ||
    Number(rawLifecycle.transientFailureCount ?? 0) > 0
  );
}

export function selectPromptOpenSource(
  rawLifecycle: OysterunMessageLifecycleRawStatus
): string | undefined {
  if (isOysterunProviderLifecycleActive(rawLifecycle.providerLifecycle)) {
    return 'host_canonical_provider_lifecycle';
  }
  if (isOysterunOptimisticRespondingActive(rawLifecycle)) {
    return 'local_send_optimistic_until_host_lifecycle';
  }
  if (selectSemanticFallbackActive(rawLifecycle)) {
    return 'semantic_fallback_while_canonical_loading';
  }
  return undefined;
}

export function selectRespondingDisplayName(
  rawLifecycle: OysterunMessageLifecycleRawStatus
): string | undefined {
  if (isOysterunProviderLifecycleActive(rawLifecycle.providerLifecycle)) {
    return rawLifecycle.providerLifecycle?.display_name || 'Agent';
  }
  if (isOysterunOptimisticRespondingActive(rawLifecycle) || selectSemanticFallbackActive(rawLifecycle)) {
    return rawLifecycle.semanticActivity?.displayName ?? 'Agent';
  }
  return undefined;
}

export function selectOysterunRouteCRespondingState(
  rawLifecycle: OysterunMessageLifecycleRawStatus
): OysterunRouteCRespondingState {
  const providerLifecycle = rawLifecycle.providerLifecycle;
  const canonicalTerminal = isOysterunProviderLifecycleTerminal(providerLifecycle);
  const optimisticActive = isOysterunOptimisticRespondingActive(rawLifecycle);
  const displayName = selectRespondingDisplayName(rawLifecycle);
  return {
    rawLifecycle,
    agentResponding: Boolean(displayName),
    displayName,
    sourceUserEventId:
      providerLifecycle?.source_user_event_id ?? rawLifecycle.semanticActivity?.sourceUserEventId,
    host2IntakeState: providerLifecycle?.host2_intake_state ?? undefined,
    agentTurnStarted: providerLifecycle?.agent_turn_started,
    providerDeliveryClaimed: providerLifecycle?.provider_delivery_claimed,
    finalResultForSource: providerLifecycle ? canonicalTerminal : undefined,
    outboxMessageState: providerLifecycle?.active_message_state ?? undefined,
    outboxDeliveryState: providerLifecycle?.delivery_state ?? undefined,
    outboxActiveMessageState: rawLifecycle.snapshot?.delivery?.active_message_state,
    promptOpenSource: selectPromptOpenSource(rawLifecycle),
    latestSemanticType: rawLifecycle.semanticActivity?.latestSemanticType,
    providerLifecycleSource: providerLifecycle?.source,
    providerLifecycleState: providerLifecycle?.state,
    providerLifecycleActive: providerLifecycle?.active,
    providerLifecycleTerminal: providerLifecycle?.terminal,
    relatedPollingAllowed: providerLifecycle ? providerLifecycle.related_polling_allowed : true,
    canonicalLifecycleKnown: Boolean(providerLifecycle),
    optimisticClientRequestId: optimisticActive ? rawLifecycle.optimistic?.clientRequestId : undefined,
    pendingControlRequestCount: providerLifecycle?.pending_control_request_count,
  };
}

export function isOysterunHost2CancelableProof(
  proof: OysterunHost2IntakeProof,
  eventId: string
): boolean {
  return (
    proof.host2_receipt_target_event_id === eventId &&
    proof.matrix_server_event_id === eventId &&
    proof.host2_intake_state === 'host2_queued' &&
    proof.cancelable === true &&
    proof.agent_turn_started === false
  );
}

export function isOysterunHost2CancelPollingTerminalProof(
  proof: OysterunHost2IntakeProof,
  eventId: string
): boolean {
  return (
    proof.host2_receipt_target_event_id === eventId &&
    proof.matrix_server_event_id === eventId &&
    (proof.agent_turn_started === true ||
      proof.provider_delivery_claimed === true ||
      proof.provider_delivery_attempted === true ||
      proof.cancelable !== true ||
      proof.host2_intake_state !== 'host2_queued')
  );
}

export function isOysterunCancelControlRenderStatus(
  status: OysterunHost2CancelControlState['status']
): status is 'ready' | 'canceling' | 'accepted' | 'error' {
  return (
    status === 'ready' || status === 'canceling' || status === 'accepted' || status === 'error'
  );
}
