/**
 * Normalize a same-origin Oysterun app route without deciding whether the
 * client router currently implements the destination.
 *
 * @param {unknown} rawTarget
 * @param {unknown} currentOrigin
 * @returns {string | undefined}
 */
export function normalizeOysterunInternalAppRouteTarget(rawTarget, currentOrigin) {
  if (typeof rawTarget !== 'string' || !rawTarget.trim()) return undefined;
  if (typeof currentOrigin !== 'string' || !currentOrigin.trim()) return undefined;

  let originUrl;
  let targetUrl;
  try {
    originUrl = new URL(currentOrigin);
    targetUrl = new URL(rawTarget.trim(), originUrl.origin);
  } catch {
    return undefined;
  }

  if (targetUrl.origin !== originUrl.origin) return undefined;
  if (!targetUrl.pathname.startsWith('/app/')) return undefined;
  return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
}
