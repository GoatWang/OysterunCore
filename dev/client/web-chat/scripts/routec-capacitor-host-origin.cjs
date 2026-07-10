const { existsSync, readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join, resolve } = require('node:path');

const DEFAULT_CAPACITOR_APP_ID = 'com.example.oysteruncore.dev';
const DEFAULT_CAPACITOR_APP_NAME = 'OysterunCoreDev';

function normalizeOrigin(value, source) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${source} must be a non-empty URL origin.`);
  }

  const parsed = new URL(value.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${source} must use http or https.`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${source} must be an origin without path, query, or hash.`);
  }

  return parsed.origin;
}

function resolveHostConfigPath(env = process.env) {
  const explicitConfigPath = env.OYSTERUN_CAPACITOR_HOST_CONFIG?.trim();
  if (explicitConfigPath) {
    return resolve(explicitConfigPath);
  }

  const configDir = env.OYSTERUN_CONFIG_DIR?.trim();
  if (configDir) {
    return join(resolve(configDir), 'config.json');
  }

  const stackName = env.OYSTERUN_CAPACITOR_STACK?.trim() || env.OYSTERUN_STACK?.trim() || 'production';
  if (stackName === 'production') {
    return join(homedir(), '.oysterun', 'config.json');
  }

  const stacksDir = env.OYSTERUN_STACKS_DIR?.trim()
    ? resolve(env.OYSTERUN_STACKS_DIR)
    : join(homedir(), '.oysterun-stacks');
  return join(stacksDir, stackName, 'host', 'config.json');
}

function readHostConfig(configPath) {
  if (!existsSync(configPath)) {
    throw new Error(`Host config.json not found: ${configPath}`);
  }

  const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Host config.json must be a JSON object: ${configPath}`);
  }
  return parsed;
}

function normalizeCapacitorAppId(value, source) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error(`${source} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/.test(trimmed)
  ) {
    throw new Error(`${source} must be a reverse-DNS bundle identifier.`);
  }
  return trimmed;
}

function normalizeCapacitorAppName(value, source) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error(`${source} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/[\r\n]/.test(trimmed)) {
    throw new Error(`${source} must be a single-line string.`);
  }
  return trimmed;
}

function resolveOptionalHostConfig(env = process.env) {
  const configPath = resolveHostConfigPath(env);
  const configWasExplicit =
    Boolean(env.OYSTERUN_CAPACITOR_HOST_CONFIG?.trim()) ||
    Boolean(env.OYSTERUN_CONFIG_DIR?.trim()) ||
    Boolean(env.OYSTERUN_CAPACITOR_STACK?.trim()) ||
    Boolean(env.OYSTERUN_STACK?.trim());
  if (!existsSync(configPath)) {
    if (configWasExplicit) {
      throw new Error(`Host config.json not found: ${configPath}`);
    }
    return {
      config: null,
      configPath: null,
    };
  }

  return {
    config: readHostConfig(configPath),
    configPath,
  };
}

function resolveRouteCCapacitorAppIdentity(env = process.env) {
  const envAppId = normalizeCapacitorAppId(
    env.OYSTERUN_CAPACITOR_APP_ID,
    'OYSTERUN_CAPACITOR_APP_ID'
  );
  const envAppName = normalizeCapacitorAppName(
    env.OYSTERUN_CAPACITOR_APP_NAME,
    'OYSTERUN_CAPACITOR_APP_NAME'
  );

  return {
    appId: envAppId || DEFAULT_CAPACITOR_APP_ID,
    appIdSource: envAppId
      ? 'env:OYSTERUN_CAPACITOR_APP_ID'
      : 'default:com.example.oysteruncore.dev',
    appName: envAppName || DEFAULT_CAPACITOR_APP_NAME,
    appNameSource: envAppName
      ? 'env:OYSTERUN_CAPACITOR_APP_NAME'
      : 'default:OysterunCoreDev',
    configPath: null,
  };
}

function normalizePort(value, source) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${source} must contain a valid TCP port.`);
  }
  return port;
}

function resolveRouteCCapacitorHostOrigin(env = process.env) {
  const explicitOrigin = env.OYSTERUN_CAPACITOR_HOST_ORIGIN?.trim();
  if (explicitOrigin) {
    return {
      configPath: null,
      origin: normalizeOrigin(explicitOrigin, 'OYSTERUN_CAPACITOR_HOST_ORIGIN'),
      source: 'env:OYSTERUN_CAPACITOR_HOST_ORIGIN',
    };
  }

  const configPath = resolveHostConfigPath(env);
  const config = readHostConfig(configPath);
  const publicBaseUrl = typeof config.public_base_url === 'string' ? config.public_base_url.trim() : '';
  if (publicBaseUrl) {
    return {
      configPath,
      origin: normalizeOrigin(publicBaseUrl, `${configPath}:public_base_url`),
      source: `${configPath}:public_base_url`,
    };
  }

  const port = normalizePort(config.port, `${configPath}:port`);
  const explicitLocalHost = env.OYSTERUN_CAPACITOR_LOCAL_HOST?.trim();
  const localHost = explicitLocalHost || 'localhost';
  const localHostSource = explicitLocalHost
    ? 'env:OYSTERUN_CAPACITOR_LOCAL_HOST'
    : 'default:localhost';
  return {
    configPath,
    origin: normalizeOrigin(`http://${localHost}:${port}`, `${configPath}:port`),
    source: `${configPath}:port + ${localHostSource}`,
  };
}

function resolveRouteCCapacitorHostDisplayName(env = process.env) {
  const configPath = resolveHostConfigPath(env);
  if (!existsSync(configPath)) {
    return {
      configPath: null,
      displayName: '',
      source: 'missing_host_config',
    };
  }
  const config = readHostConfig(configPath);
  const displayName =
    typeof config.display_name === 'string' ? config.display_name.trim() : '';
  return {
    configPath,
    displayName,
    source: displayName ? `${configPath}:display_name` : 'empty_display_name',
  };
}

module.exports = {
  DEFAULT_CAPACITOR_APP_ID,
  DEFAULT_CAPACITOR_APP_NAME,
  resolveHostConfigPath,
  resolveRouteCCapacitorAppIdentity,
  resolveRouteCCapacitorHostDisplayName,
  resolveRouteCCapacitorHostOrigin,
};
