#!/usr/bin/env node

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  resolveRouteCCapacitorAppIdentity,
  resolveRouteCCapacitorHostDisplayName,
  resolveRouteCCapacitorHostOrigin,
} = require('./routec-capacitor-host-origin.cjs');

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(rootDir, 'capacitor.config.json');
const bootstrapDir = resolve(rootDir, 'capacitor-bootstrap');
const bootstrapConfigPath = resolve(
  bootstrapDir,
  'oysterun-capacitor-bootstrap-config.js'
);
const bootstrapJsQrPath = resolve(bootstrapDir, 'jsQR.js');

function normalizeBooleanEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function normalizeStartPath(value) {
  const path = value?.trim() || '/app';
  if (!path.startsWith('/')) {
    throw new Error('OYSTERUN_CAPACITOR_START_PATH must start with /.');
  }
  if (path.includes('://')) {
    throw new Error('OYSTERUN_CAPACITOR_START_PATH must be a path, not an absolute URL.');
  }
  return path;
}

function hasExplicitHostTargetEnv() {
  return Boolean(
    process.env.OYSTERUN_CAPACITOR_HOST_ORIGIN?.trim() ||
      process.env.OYSTERUN_CAPACITOR_HOST_CONFIG?.trim() ||
      process.env.OYSTERUN_CAPACITOR_STACK?.trim()
  );
}

function resolveBootstrapHostDefaults(runtimeBootstrap) {
  if (!runtimeBootstrap || hasExplicitHostTargetEnv()) {
    return {
      resolvedHost: resolveRouteCCapacitorHostOrigin(),
      resolvedHostDisplayName: resolveRouteCCapacitorHostDisplayName(),
    };
  }
  return {
    resolvedHost: {
      origin: '',
      source: 'runtime_bootstrap:no_default_host',
      configPath: null,
    },
    resolvedHostDisplayName: {
      displayName: '',
      source: 'runtime_bootstrap:no_default_host',
    },
  };
}

function writeBootstrapConfig({
  appIdentity,
  resolvedHost,
  resolvedHostDisplayName,
  startPath,
}) {
  mkdirSync(bootstrapDir, { recursive: true });
  copyFileSync(
    resolve(rootDir, 'node_modules/jsqr/dist/jsQR.js'),
    bootstrapJsQrPath
  );
  writeFileSync(
    bootstrapConfigPath,
    `window.OYSTERUN_CAPACITOR_BOOTSTRAP_CONFIG = ${JSON.stringify(
      {
        appName: appIdentity.appName,
        defaultHostOrigin: resolvedHost.origin,
        defaultHostDisplayName: resolvedHostDisplayName.displayName,
        defaultHostDisplayNameSource: resolvedHostDisplayName.source,
        hostOriginSource: resolvedHost.source,
        hostConfigPath: resolvedHost.configPath,
        hostTargetStorageKey: 'oysterun.stage1.host_target.v1',
        startPath,
      },
      null,
      2
    )};\n`
  );
}

function buildServerConfig() {
  const appIdentity = resolveRouteCCapacitorAppIdentity();
  const startPath = normalizeStartPath(process.env.OYSTERUN_CAPACITOR_START_PATH);
  const runtimeBootstrap = normalizeBooleanEnv(
    process.env.OYSTERUN_CAPACITOR_RUNTIME_BOOTSTRAP
  );
  const { resolvedHost, resolvedHostDisplayName } =
    resolveBootstrapHostDefaults(runtimeBootstrap);

  if (runtimeBootstrap) {
    writeBootstrapConfig({
      appIdentity,
      resolvedHost,
      resolvedHostDisplayName,
      startPath,
    });
    return {
      appIdentity,
      resolvedHost,
      runtimeBootstrap,
      webDir: 'capacitor-bootstrap',
      server: {
        allowNavigation: ['*'],
        cleartext: true,
      },
      startPath,
    };
  }

  const origin = new URL(resolvedHost.origin);
  return {
    appIdentity,
    resolvedHost,
    runtimeBootstrap,
    webDir: 'dist',
    server: {
      allowNavigation: [origin.hostname],
      cleartext: origin.protocol === 'http:',
      url: new URL(startPath, origin).toString(),
    },
    startPath,
  };
}

const { appIdentity, resolvedHost, runtimeBootstrap, server, startPath, webDir } =
  buildServerConfig();
const config = {
  appId: appIdentity.appId,
  appName: appIdentity.appName,
  webDir,
  server,
  ios: {
    contentInset: 'never',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#fffdfa',
    },
    LocalNotifications: {
      presentationOptions: ['banner', 'list', 'sound'],
    },
    PushNotifications: {
      presentationOptions: ['banner', 'list', 'sound'],
    },
  },
};

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      ok: true,
      generated_config_path: configPath,
      runtime_bootstrap: runtimeBootstrap,
      bootstrap_config_path: runtimeBootstrap ? bootstrapConfigPath : null,
      host_origin: runtimeBootstrap
        ? resolvedHost.origin
        : new URL(server.url).origin,
      host_origin_source: resolvedHost.source,
      host_config_path: resolvedHost.configPath,
      app_id: appIdentity.appId,
      app_id_source: appIdentity.appIdSource,
      app_name: appIdentity.appName,
      app_name_source: appIdentity.appNameSource,
      web_dir: webDir,
      start_path: startPath,
      server_url: server.url || null,
      allow_navigation: server.allowNavigation,
      cleartext: server.cleartext,
    },
    null,
    2
  )
);
