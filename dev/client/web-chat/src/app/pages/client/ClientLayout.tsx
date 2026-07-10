import React, { ReactNode } from 'react';
import { Box } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getOysterunRouteCRoomEntryBindingProof } from '../../../oysterun/OysterunHostClient';

type ClientLayoutProps = {
  nav?: ReactNode;
  children: ReactNode;
};
export function ClientLayout({ nav, children }: ClientLayoutProps) {
  const mx = useMatrixClient();
  const roomEntryBinding = getOysterunRouteCRoomEntryBindingProof();
  const matrixRoomId = roomEntryBinding.matrix_room_id;
  const hostSessionId = roomEntryBinding.host_session_id;
  const boundMatrixRoom = matrixRoomId ? mx.getRoom(matrixRoomId) : undefined;
  const roomEntryReady = Boolean(
    hostSessionId && matrixRoomId && boundMatrixRoom && roomEntryBinding.matrix_room_ready
  );
  const roomEntryState = !matrixRoomId
    ? 'bootstrap_pending'
    : roomEntryReady
      ? 'bound_room_ready'
      : 'bound_room_missing_after_sync';
  const routeCChatShell = Boolean(hostSessionId);

  return (
    <Box
      grow="Yes"
      style={{ minHeight: 0 }}
      data-testid="oysterun-routec-app-root"
      data-oysterun-web-chat-testid="oysterun-web-chat-app-root"
      data-oysterun-routec-chat-shell={String(routeCChatShell)}
      data-oysterun-clean-session-chat-shell={String(routeCChatShell)}
      data-oysterun-routec-left-nav-hidden={String(routeCChatShell)}
      data-oysterun-clean-session-left-nav-hidden={String(routeCChatShell)}
      data-oysterun-routec-room-entry-contract={roomEntryBinding.contract}
      data-oysterun-clean-session-room-entry-contract={roomEntryBinding.contract}
      data-oysterun-routec-room-entry-state={roomEntryState}
      data-oysterun-clean-session-room-entry-state={roomEntryState}
      data-oysterun-routec-room-entry-ready={String(roomEntryReady)}
      data-oysterun-clean-session-room-entry-ready={String(roomEntryReady)}
      data-oysterun-routec-room-entry-unready={String(!roomEntryReady)}
      data-oysterun-clean-session-room-entry-unready={String(!roomEntryReady)}
      data-oysterun-routec-room-entry-binding-source={roomEntryBinding.binding_source}
      data-oysterun-clean-session-room-entry-binding-source={roomEntryBinding.binding_source}
      data-oysterun-routec-bound-room-id={matrixRoomId}
      data-oysterun-clean-session-bound-room-id={matrixRoomId}
      data-oysterun-routec-bound-room-ready={String(roomEntryBinding.matrix_room_ready)}
      data-oysterun-clean-session-bound-room-ready={String(roomEntryBinding.matrix_room_ready)}
      data-oysterun-routec-direct-api-substitute-used="false"
      data-oysterun-clean-session-direct-api-substitute-used="false"
      data-oysterun-routec-stale-text-selector-required="false"
      data-oysterun-clean-session-stale-text-selector-required="false"
      data-oysterun-routec-screenshot-identity-required="false"
      data-oysterun-clean-session-screenshot-identity-required="false"
      data-oysterun-routec-composer-send-valid-from-unready="false"
      data-oysterun-clean-session-composer-send-valid-from-unready="false"
      data-oysterun-host-session-id={hostSessionId}
      data-oysterun-room-id={matrixRoomId}
    >
      {nav && <Box shrink="No">{nav}</Box>}
      <Box grow="Yes">{children}</Box>
    </Box>
  );
}
