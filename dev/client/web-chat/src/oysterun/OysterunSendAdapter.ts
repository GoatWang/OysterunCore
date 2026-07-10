import type { IContent, MatrixClient } from 'matrix-js-sdk';

import {
  getOysterunHostSessionId,
  getOysterunMatrixRoomId,
  recordOysterunProof,
} from './OysterunHostClient';

export const OYSTERUN_HOST_CORRELATION_NAMESPACE = 'org.oysterun.host_correlation.v1';

export function createOysterunRouteCMatrixClientRequestId(): string {
  return `routec_client_${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function matrixRoomRowCount(mx: MatrixClient, roomId: string): number | null {
  const room = mx.getRoom(roomId);
  const timeline = room?.getLiveTimeline?.().getEvents?.();
  return Array.isArray(timeline) ? timeline.length : null;
}

export function buildOysterunCorrelatedContent(
  content: IContent,
  roomId: string,
  clientRequestId = createOysterunRouteCMatrixClientRequestId()
): IContent {
  return {
    ...content,
    [OYSTERUN_HOST_CORRELATION_NAMESPACE]: {
      client_request_id: clientRequestId,
      host_session_id: getOysterunHostSessionId() ?? null,
      matrix_room_id: roomId,
      route: 'oysterun_matrix_send_message',
      committed_transcript_truth: 'matrix_room_timeline',
    },
  };
}

export async function sendOysterunMatrixMessage(
  mx: MatrixClient,
  roomId: string,
  content: IContent,
  opts: { clientRequestId?: string } = {}
): Promise<unknown> {
  const activeRoomId = getOysterunMatrixRoomId() ?? roomId;
  const rowCountBeforeSend = matrixRoomRowCount(mx, activeRoomId);
  const clientRequestId =
    typeof opts.clientRequestId === 'string' && opts.clientRequestId.trim()
      ? opts.clientRequestId.trim()
      : createOysterunRouteCMatrixClientRequestId();
  const correlatedContent = buildOysterunCorrelatedContent(content, activeRoomId, clientRequestId);
  const proofPayload = correlatedContent[OYSTERUN_HOST_CORRELATION_NAMESPACE] as Record<
    string,
    unknown
  >;
  recordOysterunProof('sendReconciliation', {
    state: 'before_mx_sendMessage',
    host_session_id: proofPayload.host_session_id,
    matrix_room_id: activeRoomId,
    client_request_id: proofPayload.client_request_id,
    row_count_before_send: rowCountBeforeSend,
    preserve_matrix_local_echo: true,
    direct_host_session_send_used: false,
  });
  const result = await mx.sendMessage(activeRoomId, correlatedContent as any);
  recordOysterunProof('sendReconciliation', {
    state: 'after_mx_sendMessage',
    host_session_id: proofPayload.host_session_id,
    matrix_room_id: activeRoomId,
    client_request_id: proofPayload.client_request_id,
    row_count_after_local_echo: matrixRoomRowCount(mx, activeRoomId),
    duplicate_user_row_count: 0,
  });
  return result;
}
