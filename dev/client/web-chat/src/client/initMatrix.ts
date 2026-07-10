import { createClient, MatrixClient, IndexedDBStore } from 'matrix-js-sdk';
import { Capacitor } from '@capacitor/core';

import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import type { Session } from '../app/state/sessions';
import { pushSessionToSW } from '../sw-session';
import { recordMatrixClientInitProof } from '../oysterun/OysterunProofFields';

export type RouteCMatrixCacheScope = {
  hostSessionId: string;
  matrixRoomId: string;
};

const OYSTERUN_CRYPTO_STARTUP_MODE = 'non_e2ee_unencrypted_facade';
const OYSTERUN_CAPACITOR_BOOTSTRAP_LOGOUT_URL = 'capacitor://localhost/index.html?logged_out=1';
const ROUTEC_CRYPTO_STARTUP_STATIC_PROOF =
  'oysterun_crypto_startup_mode=non_e2ee_unencrypted_facade;keys_upload_attempted=false;foundation_pass_claimed=false';
const ROUTEC_INDEXEDDB_DB_NAME_PREFIX = 'oysterun-routec-web-sync-store';
const ROUTEC_LEGACY_GLOBAL_INDEXEDDB_DB_NAME = 'web-sync-store';
const ROUTEC_INDEXEDDB_SCOPE_SEGMENT_MAX_LENGTH = 96;

function requiredRouteCMatrixCacheScope(
  cacheScope: RouteCMatrixCacheScope | undefined
): RouteCMatrixCacheScope {
  if (!cacheScope) {
    throw new Error('Route C Matrix cache scope requires Host bootstrap binding.');
  }
  if (!cacheScope.hostSessionId.trim()) {
    throw new Error('Route C Matrix cache scope requires a Host session id.');
  }
  if (!cacheScope.matrixRoomId.trim()) {
    throw new Error('Route C Matrix cache scope requires a Matrix room id.');
  }
  return cacheScope;
}

function isOysterunCapacitorIOSRuntime(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

export function redirectToOysterunCapacitorBootstrapAfterWebChatAuthLoss(): boolean {
  if (!isOysterunCapacitorIOSRuntime()) return false;
  window.location.replace(OYSTERUN_CAPACITOR_BOOTSTRAP_LOGOUT_URL);
  return true;
}

function reloadAfterWebChatAuthReset(): void {
  if (redirectToOysterunCapacitorBootstrapAfterWebChatAuthLoss()) return;
  window.location.reload();
}

function routeCIndexedDBScopeSegment(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Route C IndexedDB cache scope missing required field: ${field}.`);
  }
  const scopedSegment = trimmed.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!scopedSegment) {
    throw new Error(`Route C IndexedDB cache scope field is not name-safe: ${field}.`);
  }
  return scopedSegment.slice(0, ROUTEC_INDEXEDDB_SCOPE_SEGMENT_MAX_LENGTH);
}

export function buildRouteCIndexedDBStoreDBName(
  session: Session,
  cacheScope: RouteCMatrixCacheScope
): string {
  const requiredCacheScope = requiredRouteCMatrixCacheScope(cacheScope);
  return [
    ROUTEC_INDEXEDDB_DB_NAME_PREFIX,
    routeCIndexedDBScopeSegment(session.baseUrl, 'baseUrl'),
    routeCIndexedDBScopeSegment(session.userId, 'userId'),
    routeCIndexedDBScopeSegment(requiredCacheScope.hostSessionId, 'hostSessionId'),
    routeCIndexedDBScopeSegment(requiredCacheScope.matrixRoomId, 'matrixRoomId'),
  ].join('__');
}

export const initClient = async (
  session: Session,
  routeCCacheScope: RouteCMatrixCacheScope
): Promise<MatrixClient> => {
  const cacheScope = requiredRouteCMatrixCacheScope(routeCCacheScope);
  const routeCIndexedDBStoreDBName = buildRouteCIndexedDBStoreDBName(session, cacheScope);
  recordMatrixClientInitProof(session, {
    oysterun_crypto_startup_mode: OYSTERUN_CRYPTO_STARTUP_MODE,
    routec_crypto_startup_static_proof: ROUTEC_CRYPTO_STARTUP_STATIC_PROOF,
    routec_indexeddb_store_db_name: routeCIndexedDBStoreDBName,
    routec_indexeddb_store_scope: 'host_origin+matrix_user_id+host_session_id+matrix_room_id',
    routec_indexeddb_store_db_name_source: 'oysterun_host_scoped_bootstrap_binding',
    routec_legacy_global_indexeddb_db_name: ROUTEC_LEGACY_GLOBAL_INDEXEDDB_DB_NAME,
    routec_legacy_global_indexeddb_store_used: false,
    routec_cache_checkpoint_boundary:
      'matrix_sync_checkpoint_bound_to_routec_host_session_and_room',
    routec_incremental_sync_checkpoint_policy:
      'reuse_checkpoint_only_with_matching_routec_host_session_room_db_name',
    host_session_id: cacheScope.hostSessionId,
    matrix_room_id: cacheScope.matrixRoomId,
    initRustCrypto_called: false,
    keys_upload_attempted: false,
    device_key_write_attempted: false,
    key_backup_write_attempted: false,
    cross_signing_attempted: false,
    broad_crypto_proxy_required: false,
    e2ee_support_claimed: false,
    raw_device_key_exposed: false,
    foundation_pass_claimed: false,
  });
  const indexedDBStore = new IndexedDBStore({
    indexedDB: global.indexedDB,
    localStorage: global.localStorage,
    dbName: routeCIndexedDBStoreDBName,
  });

  const mx = createClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    store: indexedDBStore,
    deviceId: session.deviceId,
    timelineSupport: true,
  });

  await indexedDBStore.startup();

  mx.setMaxListeners(50);

  return mx;
};

export const startClient = async (mx: MatrixClient) => {
  await mx.startClient({
    lazyLoadMembers: true,
  });
};

export const clearCacheAndReload = async (mx: MatrixClient) => {
  mx.stopClient();
  clearNavToActivePathStore(mx.getSafeUserId());
  await mx.store.deleteAllData();
  window.location.reload();
};

export const logoutClient = async (mx: MatrixClient) => {
  pushSessionToSW();
  mx.stopClient();
  try {
    await mx.logout();
  } catch {
    // ignore if failed to logout
  }
  await mx.clearStores();
  window.localStorage.clear();
  reloadAfterWebChatAuthReset();
};

export const clearLoginData = async () => {
  const dbs = await window.indexedDB.databases();

  dbs.forEach((idbInfo) => {
    const { name } = idbInfo;
    if (name) {
      window.indexedDB.deleteDatabase(name);
    }
  });

  window.localStorage.clear();
  reloadAfterWebChatAuthReset();
};
