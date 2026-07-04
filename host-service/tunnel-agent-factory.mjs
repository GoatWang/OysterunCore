import { NgrokAgent } from "./ngrok-agent.mjs";
import { FrpAgent } from "./frp-agent.mjs";

/**
 * Pick a TunnelAgent implementation by provider name.
 *
 * Both implementations share the same EventEmitter contract:
 *   start(), stop(), get alive, get publicUrl
 *   events: ready, exit, error, stderr, route_reported, route_error,
 *           heartbeat_ok, heartbeat_error
 *
 * server.mjs treats them interchangeably.
 *
 * @param {"frp"|"ngrok"} provider
 * @param {object} opts  - provider-specific options (see each Agent's constructor)
 * @returns {EventEmitter}  - FrpAgent or NgrokAgent instance
 */
export function createTunnelAgent(provider, opts) {
  if (provider === "frp") {
    return new FrpAgent(opts);
  }
  if (provider === "ngrok") {
    return new NgrokAgent(opts);
  }
  throw new Error(`Unknown tunnel provider: ${provider}`);
}
