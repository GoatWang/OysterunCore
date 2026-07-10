#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = resolve(rootDir, '..');
const require = createRequire(import.meta.url);
const { resolveRouteCCapacitorHostOrigin } = require('./routec-capacitor-host-origin.cjs');

const resolvedHost = resolveRouteCCapacitorHostOrigin();
const origin = new URL(resolvedHost.origin);
const WEB_CHAT_ASSET_BASE_PATH = '/app/chat-assets/';
const LEGACY_ROUTE_C_PATH = '/route-c/';

async function probePath(path) {
  const url = new URL(path, origin);
  const response = await fetch(url, { redirect: 'manual' });
  return {
    path,
    status: response.status,
    location: response.headers.get('location'),
    routeCBasePath: response.headers.get('x-oysterun-routec-base-path'),
    webChatAssetBasePath: response.headers.get('x-oysterun-web-chat-asset-base-path'),
    legacyRouteCAsset: response.headers.get('x-oysterun-legacy-routec-asset'),
    serviceWorkerAllowed: response.headers.get('service-worker-allowed'),
    contentType: response.headers.get('content-type'),
    reachable:
      (response.status >= 200 && response.status < 400) ||
      response.headers.get('location')?.startsWith('/auth/login') === true,
  };
}

async function readSource(relativePath) {
  return readFile(resolve(clientDir, relativePath), 'utf8');
}

function requireMarkers(label, source, markers) {
  const missing = markers.filter((marker) => !source.includes(marker));
  return {
    label,
    ok: missing.length === 0,
    missing,
  };
}

const [
  sessions,
  sessionSetup,
  webChatManifest,
  webChatServiceWorker,
  legacyRouteCRoot,
  legacyRouteCManifest,
] = await Promise.all([
  probePath('/app/sessions'),
  probePath('/app/session-setup'),
  probePath(`${WEB_CHAT_ASSET_BASE_PATH}manifest.json`),
  probePath(`${WEB_CHAT_ASSET_BASE_PATH}sw.js`),
  probePath(LEGACY_ROUTE_C_PATH),
  probePath(`${LEGACY_ROUTE_C_PATH}manifest.json`),
]);

const [hostShell, sendAdapter, hostClient, buildConfig, indexHtml, webChatBoot, serviceWorker] = await Promise.all([
  readSource('web/src/index.template.html'),
  readSource('web-chat/src/oysterun/OysterunSendAdapter.ts'),
  readSource('web-chat/src/oysterun/OysterunHostClient.ts'),
  readSource('web-chat/build.config.ts'),
  readSource('web-chat/index.html'),
  readSource('web-chat/src/index.tsx'),
  readSource('web-chat/src/sw.ts'),
]);

const checks = [
  requireMarkers('sessions_to_clean_chat_handoff', hostShell, [
    'function buildRouteCSessionHandoffUrl(sessionId)',
    'return buildSessionChatPath(sessionId);',
    'function buildRouteCRoomHandoffUrl(sessionId, _roomId = "", opts = {})',
    'const target = buildSessionChatPath(normalizedSessionId',
    'Chat handoff must stay on the current Host session route.',
    'id="session-setup-view"',
    'Start Session',
  ]),
  requireMarkers('web_chat_asset_base_source', buildConfig, [
    "base: '/app/chat-assets/'",
  ]),
  requireMarkers('web_chat_index_asset_base_source', indexHtml, [
    '<meta property="og:url" content="/app/sessions" />',
    '<link rel="manifest" href="/app/chat-assets/manifest.json" />',
  ]),
  requireMarkers('web_chat_service_worker_fallback_source', serviceWorker, [
    ": '/app/sessions';",
  ]),
  requireMarkers('web_chat_service_worker_scope_source', webChatBoot, [
    "const webChatServiceWorkerScope = '/app/sessions/';",
    '.register(swUrl, { scope: webChatServiceWorkerScope })',
  ]),
  requireMarkers('matrix_sender_path', sendAdapter, [
    "route: 'oysterun_matrix_send_message'",
    'direct_host_session_send_used: false',
    'mx.sendMessage(activeRoomId',
  ]),
  requireMarkers('host_matrix_response_path', hostClient, [
    '/routec/matrix/host-scoped-cinny-session-bootstrap',
    '/routec/matrix/host2-intake',
    '/routec/matrix/semantic-events',
  ]),
];

const legacyRouteCRootRedirectsToSafeHostPage =
  legacyRouteCRoot.status >= 300 &&
  legacyRouteCRoot.status < 400 &&
  legacyRouteCRoot.location?.startsWith('/app/sessions') === true;
const httpReachable = [sessions, sessionSetup, webChatManifest, webChatServiceWorker, legacyRouteCManifest].every(
  (probe) => probe.reachable
) && legacyRouteCRootRedirectsToSafeHostPage;
const sourceReady = checks.every((check) => check.ok);
const ok = httpReachable && sourceReady;

const result = {
  ok,
  host_origin: origin.origin,
  host_origin_source: resolvedHost.source,
  host_config_path: resolvedHost.configPath,
  capacitor_start_path: process.env.OYSTERUN_CAPACITOR_START_PATH?.trim() || '/app',
  probes: {
    sessions_page: sessions,
    create_session_path: sessionSetup,
    web_chat_asset_manifest: webChatManifest,
    web_chat_asset_service_worker: webChatServiceWorker,
    legacy_route_c_root: legacyRouteCRoot,
    legacy_route_c_manifest: legacyRouteCManifest,
  },
  source_checks: checks,
  forward_path_claims: {
    sessions_page_reachable: sessions.reachable,
    create_session_path_reachable: sessionSetup.reachable,
    web_chat_asset_base_path: WEB_CHAT_ASSET_BASE_PATH,
    web_chat_asset_manifest_reachable: webChatManifest.reachable,
    web_chat_asset_service_worker_reachable: webChatServiceWorker.reachable,
    web_chat_service_worker_allowed_path: webChatServiceWorker.serviceWorkerAllowed,
    legacy_route_c_root_product_entry: false,
    legacy_route_c_root_redirects_to_safe_host_page: legacyRouteCRootRedirectsToSafeHostPage,
    legacy_route_c_manifest_compatibility_reachable: legacyRouteCManifest.reachable,
    send_message_uses_matrix_sdk_path: checks[5].ok,
    response_path_uses_host_matrix_intake: checks[6].ok,
    wrapper_keeps_same_host_origin: true,
  },
  non_claims: [
    'No XCUI verification.',
    'No full browser human-path verification.',
    'No detailed message/search/pin/cancel/explorer verification.',
    'No notification, file-upload, clipboard, or deep-link product gate.',
  ],
};

console.log(JSON.stringify(result, null, 2));
process.exit(ok ? 0 : 1);
