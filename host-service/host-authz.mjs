export function hasAgentAccess(claims, agentId) {
  if (claims?._dashboardAuth) return true;
  return Array.isArray(claims?.agent_ids) && claims.agent_ids.includes(agentId);
}

export function hasAgentCapability(claims, agentId, capability) {
  if (claims?._dashboardAuth) return true;
  if (!hasAgentAccess(claims, agentId)) return false;
  return claims?.agent_perms?.[agentId]?.[capability] === true;
}
