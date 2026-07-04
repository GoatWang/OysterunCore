import type { MatrixClient } from 'matrix-js-sdk';

import { startClient } from '../client/initMatrix';
import type { RouteCMatrixCacheScope } from '../client/initMatrix';
import type { Session } from '../app/state/sessions';
import {
  bootstrapOysterunMatrixSession,
  clearOysterunMatrixBootstrapCache,
  getOysterunBootstrappedHostSessionId,
  getOysterunBootstrappedRoomId,
  type OysterunMatrixBootstrapResponse,
} from './OysterunHostClient';

export async function loadOysterunMatrixBootstrap(): Promise<OysterunMatrixBootstrapResponse> {
  return bootstrapOysterunMatrixSession();
}

export function resetOysterunMatrixBootstrap(reason: string): void {
  clearOysterunMatrixBootstrapCache(reason);
}

export function getOysterunRouteCMatrixCacheScope(
  bootstrap: OysterunMatrixBootstrapResponse
): RouteCMatrixCacheScope {
  return {
    hostSessionId: bootstrap.binding.host_session_id,
    matrixRoomId: bootstrap.binding.matrix_room_id,
  };
}

export async function loadOysterunMatrixBootstrapSession(): Promise<Session> {
  const bootstrap = await bootstrapOysterunMatrixSession();
  return {
    ...bootstrap.session,
    fallbackSdkStores: false,
  };
}

export async function startOysterunMatrixClient(mx: MatrixClient): Promise<void> {
  await startClient(mx);
}

export function getOysterunMatrixRoomId(): string | undefined {
  return getOysterunBootstrappedRoomId();
}

export function getOysterunHostSessionId(): string | undefined {
  return getOysterunBootstrappedHostSessionId();
}
