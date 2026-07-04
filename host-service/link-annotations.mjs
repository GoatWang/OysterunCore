import { existsSync, realpathSync, statSync } from "fs";
import { basename, dirname, join, parse, relative, resolve } from "path";
import { resolveAgentWebConfig } from "./agent-config.mjs";

const PREVIEW_MODE_RENDERED = "rendered";
const HTTP_URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const MARKDOWN_LINK_RE = /!?\[([^\]\n]+)\]\(([^)\n]+)\)/g;
const FENCED_CODE_RE = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/gm;
const LEADING_TRIM_RE = /^[("'[{<]+/;
const TRAILING_TRIM_RE = /[)\]}>,"'.!?;:]+$/;
const GENERIC_PATH_RE = /^[A-Za-z0-9._~/-]+$/;
const IGNORABLE_PATH_CANDIDATE_ERROR_CODES = new Set([
  "EACCES",
  "ELOOP",
  "ENAMETOOLONG",
  "ENOENT",
  "ENOTDIR",
  "EPERM",
  "EINVAL",
]);

function addRange(ranges, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return;
  ranges.push({ start, end });
}

function mergeRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return [];
  const ordered = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [ordered[0]];
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index];
    const previous = merged[merged.length - 1];
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }
    merged.push({ ...current });
  }
  return merged;
}

function isIndexInsideRanges(index, ranges) {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function collectExcludedRanges(text) {
  return collectRangesForPatterns(text, [FENCED_CODE_RE, INLINE_CODE_RE, MARKDOWN_LINK_RE]);
}

function collectMarkdownLinkBlockingRanges(text) {
  return mergeRanges([
    ...collectRangesForPatterns(text, [FENCED_CODE_RE, INLINE_CODE_RE]),
    ...collectAttachmentBlockRange(text),
  ]);
}

function collectRangesForPatterns(text, patterns) {
  const ranges = [];
  const normalized = String(text || "");
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(normalized)) !== null) {
      addRange(ranges, match.index, match.index + match[0].length);
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }
    }
  }
  return mergeRanges(ranges);
}

function collectCandidateSegments(text, excludedRanges) {
  const segments = [];
  let cursor = 0;
  for (const range of excludedRanges) {
    if (cursor < range.start) {
      segments.push({ start: cursor, end: range.start });
    }
    cursor = range.end;
  }
  if (cursor < text.length) {
    segments.push({ start: cursor, end: text.length });
  }
  return segments.filter((segment) => segment.end > segment.start);
}

function trimToken(rawToken, startIndex, endIndex) {
  const token = String(rawToken || "");
  let start = startIndex;
  let end = endIndex;
  let value = token;

  const leadingMatch = value.match(LEADING_TRIM_RE);
  if (leadingMatch && leadingMatch[0].length > 0) {
    start += leadingMatch[0].length;
    value = value.slice(leadingMatch[0].length);
  }

  const trailingMatch = value.match(TRAILING_TRIM_RE);
  if (trailingMatch && trailingMatch[0].length > 0) {
    end -= trailingMatch[0].length;
    value = value.slice(0, value.length - trailingMatch[0].length);
  }

  return {
    value,
    start,
    end,
  };
}

function isWhitespaceCharacter(value) {
  return /\s/u.test(value);
}

function hasLeadingUriScheme(value) {
  const normalized = String(value || "").trim();
  const schemeMatch = normalized.match(/^[A-Za-z][A-Za-z0-9+.-]*:/);
  if (!schemeMatch) return false;
  const colonIndex = schemeMatch[0].length - 1;
  const boundaryIndexes = [normalized.indexOf("/"), normalized.indexOf("?"), normalized.indexOf("#")]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  return boundaryIndexes.length === 0 || colonIndex < boundaryIndexes[0];
}

function isPathCandidate(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return false;
  if (/^https?:\/\//i.test(candidate)) return false;
  if (isDeprecatedDeliverablesRouteCandidate(candidate)) return false;
  if (candidate.startsWith("/sites/")) return true;
  if (candidate.startsWith("/app/file-preview?")) return true;
  const pathCandidate = parseLocalPathLineSuffix(candidate).path;
  if (pathCandidate.startsWith("/")) return GENERIC_PATH_RE.test(pathCandidate);
  if (pathCandidate.startsWith("./") || pathCandidate.startsWith("../")) return GENERIC_PATH_RE.test(pathCandidate);
  if (!pathCandidate.includes("/")) return false;
  return GENERIC_PATH_RE.test(pathCandidate);
}

function isExpandableLocalPathCandidatePrefix(value) {
  const candidate = String(value || "").trim();
  return (
    candidate.startsWith("/") ||
    candidate.startsWith("./") ||
    candidate.startsWith("../")
  );
}

function isDeprecatedDeliverablesRouteCandidate(value) {
  const candidate = String(value || "").trim();
  return candidate === "/deliverables" || candidate.startsWith("/deliverables/");
}

function isIgnorablePathCandidateError(error) {
  const errorCode = error?.code;
  return typeof errorCode === "string" && IGNORABLE_PATH_CANDIDATE_ERROR_CODES.has(errorCode);
}

function chooseBaseDirectory(candidate, { agentRoot, sourceFilePath }) {
  if (candidate.startsWith("./") || candidate.startsWith("../")) {
    if (sourceFilePath) return dirname(sourceFilePath);
    if (agentRoot) return agentRoot;
    return null;
  }
  if (candidate.startsWith("/")) return null;
  if (agentRoot) return agentRoot;
  if (sourceFilePath) return dirname(sourceFilePath);
  return null;
}

function determinePreviewMode() {
  return PREVIEW_MODE_RENDERED;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function parseLocalPathLineSuffix(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(.*):([1-9][0-9]*)$/);
  if (!match) {
    return {
      path: normalized,
      line: null,
      lineSuffix: "",
    };
  }
  const path = match[1] || "";
  if (!path) {
    return {
      path: normalized,
      line: null,
      lineSuffix: "",
    };
  }
  return {
    path,
    line: Number(match[2]),
    lineSuffix: `:${match[2]}`,
  };
}

function appendLocalPathLineSuffix(filePath, lineSuffix = "") {
  return lineSuffix ? `${filePath}${lineSuffix}` : filePath;
}

function isLocalPathDisclosureKind(kind) {
  return kind === "file_preview_link" || kind === "directory_link";
}

function buildFilePreviewTarget(filePath, { lineSuffix = "" } = {}) {
  const params = new URLSearchParams();
  params.set("path", appendLocalPathLineSuffix(filePath, lineSuffix));
  params.set("mode", determinePreviewMode(filePath));
  return `/app/file-preview?${params.toString()}`;
}

function buildExplorerTarget(directoryPath) {
  const params = new URLSearchParams();
  params.set("path", directoryPath);
  return `/app/explorer?${params.toString()}`;
}

function buildUnsupportedLocalPathTarget(candidate) {
  const params = new URLSearchParams();
  params.set("path", String(candidate || ""));
  return `/app/unsupported-local-path?${params.toString()}`;
}

function buildUnsupportedLocalPathResult(candidate) {
  const displayText = String(candidate || "").trim();
  return {
    kind: "unsupported_local_path",
    openMode: "unsupported",
    target: buildUnsupportedLocalPathTarget(displayText),
    displayText,
  };
}

function isPathInsideRoot(candidatePath, rootPath) {
  if (!candidatePath || !rootPath) return true;
  if (rootPath === parse(rootPath).root) return candidatePath.startsWith(rootPath);
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`);
}

function buildFilePreviewDisplayText(realPath, { agentRoot, lineSuffix = "" } = {}) {
  let displayPath = realPath;
  if (agentRoot && isPathInsideRoot(realPath, agentRoot)) {
    const relativePath = relative(agentRoot, realPath);
    if (relativePath && !relativePath.startsWith("..")) {
      displayPath = relativePath;
    }
  }
  return appendLocalPathLineSuffix(displayPath, lineSuffix);
}

function buildLocalPathDisplayPolicy(realPath, { agentRoot, lineSuffix = "" } = {}) {
  const pathDisplayText = buildFilePreviewDisplayText(realPath, { agentRoot, lineSuffix });
  const pathDisplayKind =
    agentRoot &&
    isPathInsideRoot(realPath, agentRoot) &&
    pathDisplayText !== appendLocalPathLineSuffix(realPath, lineSuffix)
      ? "agent_relative"
      : "absolute";
  const baseDisplayText = basename(realPath) || realPath;
  return {
    collapsedDisplayText: appendLocalPathLineSuffix(baseDisplayText, lineSuffix),
    pathDisplayText,
    pathDisplayKind,
  };
}

function findNearestAgentRoot(startPath) {
  const normalized = String(startPath || "").trim();
  if (!normalized) return null;
  const stats = statSync(normalized, { throwIfNoEntry: false });
  if (!stats) return null;
  let current = stats.isDirectory() ? normalized : dirname(normalized);
  while (current) {
    const configPath = join(current, ".oysterun", "config.json");
    if (existsSync(configPath)) {
      return realpathSync(current);
    }
    const parent = parse(current).root === current ? "" : dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
}

function normalizeRelativeSitePath(relativePath) {
  const rawValue = String(relativePath || "");
  const preserveTrailingSlash = rawValue.endsWith("/");
  const normalized = rawValue.replace(/^\/+/, "");
  if (!normalized) return "";
  const encodedPath = normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(safeDecodeURIComponent(segment)))
    .join("/");
  if (!encodedPath) return "";
  return preserveTrailingSlash ? `${encodedPath}/` : encodedPath;
}

function buildSiteTarget(agentId, relativePath = "") {
  const encodedAgentId = encodeURIComponent(String(agentId || "").trim());
  const normalizedRelativePath = normalizeRelativeSitePath(relativePath);
  if (!normalizedRelativePath) {
    return `/sites/${encodedAgentId}/`;
  }
  return `/sites/${encodedAgentId}/${normalizedRelativePath}`;
}

function parseSiteCandidate(candidate) {
  const normalized = String(candidate || "").trim();
  if (!normalized.startsWith("/sites/")) return null;
  const withoutPrefix = normalized.slice("/sites/".length);
  const [agentIdSegment, ...remainingSegments] = withoutPrefix.split("/");
  const agentId = safeDecodeURIComponent(agentIdSegment || "");
  if (!agentId) return null;
  return {
    agentId,
    relativePath: remainingSegments.join("/"),
  };
}

function resolveSiteCandidate(candidate, { currentAgentId, currentAgentRoot, resolveAgentFolderForSite }) {
  const parsed = parseSiteCandidate(candidate);
  if (!parsed) return null;
  const agentFolder = parsed.agentId === currentAgentId
    ? currentAgentRoot
    : resolveAgentFolderForSite?.(parsed.agentId) || null;
  if (!agentFolder) return null;
  const agentFolderStats = statSync(agentFolder, { throwIfNoEntry: false });
  if (!agentFolderStats?.isDirectory()) return null;
  const agentRoot = realpathSync(agentFolder);
  const webConfig = resolveAgentWebConfig(agentRoot);
  const configuredRoot = resolve(agentRoot, webConfig.root);
  const configuredStats = statSync(configuredRoot, { throwIfNoEntry: false });
  if (!configuredStats?.isDirectory()) return null;
  const realRoot = realpathSync(configuredRoot);
  if (realRoot !== agentRoot && !realRoot.startsWith(`${agentRoot}/`)) return null;

  const normalizedRelativePath = parsed.relativePath ? safeDecodeURIComponent(parsed.relativePath) : "";
  const requestedPath = normalizedRelativePath ? resolve(realRoot, normalizedRelativePath) : join(realRoot, "index.html");
  const requestedStats = statSync(requestedPath, { throwIfNoEntry: false });
  if (!requestedStats) return null;
  const realRequestedPath = realpathSync(requestedPath);
  if (realRequestedPath !== realRoot && !realRequestedPath.startsWith(`${realRoot}/`)) return null;

  let finalPath = realRequestedPath;
  let finalStats = requestedStats;
  if (requestedStats.isDirectory()) {
    finalPath = join(realRequestedPath, "index.html");
    finalStats = statSync(finalPath, { throwIfNoEntry: false });
    if (!finalStats?.isFile()) return null;
  }
  if (!finalStats.isFile()) return null;
  return {
    kind: "browser_link",
    openMode: "browser",
    target: buildSiteTarget(parsed.agentId, parsed.relativePath),
  };
}

function resolveLocalCandidatePath(candidate, { agentRoot, sourceFilePath }) {
  const baseDirectory = chooseBaseDirectory(candidate, { agentRoot, sourceFilePath });
  return candidate.startsWith("/")
    ? resolve(candidate)
    : baseDirectory
      ? resolve(baseDirectory, candidate)
      : null;
}

function resolvePreviewPathCandidate(candidate, { agentRoot, sourceFilePath }) {
  const normalizedCandidate = String(candidate || "").trim();
  const resolvedPath = resolveLocalCandidatePath(normalizedCandidate, { agentRoot, sourceFilePath });
  if (!resolvedPath) return null;
  try {
    const rawStats = statSync(resolvedPath, { throwIfNoEntry: false });
    const parsedLineSuffix = rawStats ? null : parseLocalPathLineSuffix(normalizedCandidate);
    const lineResolvedPath =
      !rawStats && parsedLineSuffix?.lineSuffix
        ? resolveLocalCandidatePath(parsedLineSuffix.path, { agentRoot, sourceFilePath })
        : null;
    const stats = rawStats || (lineResolvedPath ? statSync(lineResolvedPath, { throwIfNoEntry: false }) : null);
    if (!stats) return null;
    const effectiveResolvedPath = rawStats ? resolvedPath : lineResolvedPath;
    const lineSuffix = rawStats ? "" : parsedLineSuffix.lineSuffix;
    const line = rawStats ? null : parsedLineSuffix.line;
    const realPath = realpathSync(effectiveResolvedPath);
    // Host-authenticated local path hyperlinks are host-scoped. agentRoot and
    // allowedRoots affect display and relative resolution, not visibility.
    if (stats.isDirectory()) {
      const displayPolicy = buildLocalPathDisplayPolicy(realPath, { agentRoot });
      return {
        kind: "directory_link",
        openMode: "explorer",
        target: buildExplorerTarget(realPath),
        displayText: displayPolicy.pathDisplayText,
        collapsedDisplayText: displayPolicy.collapsedDisplayText,
        pathDisplayText: displayPolicy.pathDisplayText,
        pathDisplayKind: displayPolicy.pathDisplayKind,
        filePath: realPath,
      };
    }
    if (!stats.isFile()) return null;
    const displayPolicy = buildLocalPathDisplayPolicy(realPath, { agentRoot, lineSuffix });
    return {
      kind: "file_preview_link",
      openMode: "file_preview",
      target: buildFilePreviewTarget(realPath, { lineSuffix }),
      displayText: displayPolicy.pathDisplayText,
      collapsedDisplayText: displayPolicy.collapsedDisplayText,
      pathDisplayText: displayPolicy.pathDisplayText,
      pathDisplayKind: displayPolicy.pathDisplayKind,
      filePath: realPath,
      line,
    };
  } catch (error) {
    if (isIgnorablePathCandidateError(error)) return null;
    throw error;
  }
}

function resolveCanonicalTarget(candidate, context) {
  const normalized = String(candidate || "").trim();
  if (!normalized) return null;
  if (isDeprecatedDeliverablesRouteCandidate(normalized)) return null;
  if (normalized.startsWith("/sites/")) {
    return resolveSiteCandidate(normalized, context);
  }
  if (normalized.startsWith("/app/file-preview?")) {
    return context.includeAppFilePreviewMarkdown === true
      ? resolveAppFilePreviewCandidate(normalized, context)
      : null;
  }
  if (/^https?:\/\//i.test(normalized)) {
    return {
      kind: "external_url",
      openMode: "external",
      target: normalized,
    };
  }
  return resolvePreviewPathCandidate(normalized, context);
}

function resolveExpandedLocalPathCandidate(candidate, context) {
  const normalized = String(candidate || "").trim();
  if (!normalized || !isExpandableLocalPathCandidatePrefix(normalized)) return null;
  if (isDeprecatedDeliverablesRouteCandidate(normalized)) return null;
  return resolvePreviewPathCandidate(normalized, context);
}

function resolveAppFilePreviewCandidate(candidate, context) {
  let parsed;
  try {
    parsed = new URL(candidate, "http://oysterun.local");
  } catch {
    return null;
  }
  if (parsed.pathname !== "/app/file-preview") return null;
  const rawPath = parsed.searchParams.get("path");
  if (!rawPath) return null;
  const resolved = resolvePreviewPathCandidate(rawPath, context);
  if (!resolved || resolved.kind !== "file_preview_link") return null;
  return resolved;
}

function getResolvedDisplayText(resolved, fallback) {
  return typeof resolved?.displayText === "string" && resolved.displayText.trim()
    ? resolved.displayText.trim()
    : fallback;
}

function shouldPreserveMarkdownLocalLabel(label) {
  const normalized = String(label || "").trim();
  if (!normalized) return false;
  if (/^https?:\/\//i.test(normalized)) return false;
  if (normalized.startsWith("/app/") || normalized.startsWith("/sites/")) return false;
  if (isPathCandidate(normalized) && (normalized.includes("/") || normalized.includes("\\"))) {
    return false;
  }
  return true;
}

function buildLocalPathDisclosureDisplayFields(
  resolved,
  fallback,
  { preserveMarkdownLabel = false } = {}
) {
  if (!isLocalPathDisclosureKind(resolved?.kind)) {
    return {
      display_text: getResolvedDisplayText(resolved, fallback),
    };
  }
  const pathDisplayText =
    typeof resolved.pathDisplayText === "string" && resolved.pathDisplayText.trim()
      ? resolved.pathDisplayText.trim()
      : getResolvedDisplayText(resolved, fallback);
  let collapsedDisplayText =
    typeof resolved.collapsedDisplayText === "string" && resolved.collapsedDisplayText.trim()
      ? resolved.collapsedDisplayText.trim()
      : pathDisplayText;
  let pathDisplayKind =
    typeof resolved.pathDisplayKind === "string" && resolved.pathDisplayKind.trim()
      ? resolved.pathDisplayKind.trim()
      : "absolute";
  if (preserveMarkdownLabel && shouldPreserveMarkdownLocalLabel(fallback)) {
    collapsedDisplayText = String(fallback).trim();
    pathDisplayKind = "markdown_label_preserved";
  }
  return {
    display_text: collapsedDisplayText,
    collapsed_display_text: collapsedDisplayText,
    path_display_text: pathDisplayText,
    path_display_kind: pathDisplayKind,
  };
}

function buildUnsupportedLocalPathDisplayFields(resolved, fallback) {
  const displayText = typeof resolved?.displayText === "string" && resolved.displayText.trim()
    ? resolved.displayText.trim()
    : String(fallback || "").trim();
  return {
    display_text: displayText,
    path_display_text: displayText,
    path_display_kind: "unsupported_local_path",
  };
}

function buildLinkAnnotationDisplayFields(resolved, fallback, options = {}) {
  if (resolved?.kind === "unsupported_local_path") {
    return buildUnsupportedLocalPathDisplayFields(resolved, fallback);
  }
  return buildLocalPathDisclosureDisplayFields(resolved, fallback, options);
}

function collectExpandedPathEndCandidates(text, start, end) {
  const candidates = new Set([end]);
  for (let index = start; index < end; index += 1) {
    const character = text[index];
    if (character === "\n" || character === "\r") {
      candidates.add(index);
      break;
    }
    if (index > start && isWhitespaceCharacter(character)) {
      candidates.add(index);
    }
  }
  return [...candidates]
    .filter((candidateEnd) => candidateEnd > start)
    .sort((left, right) => right - left);
}

function findExpandedPlainPathAnnotation(text, start, minEnd, segmentEnd, context) {
  const lineBreakIndex = text.indexOf("\n", start);
  const searchEnd =
    lineBreakIndex >= 0 && lineBreakIndex < segmentEnd ? lineBreakIndex : segmentEnd;
  const maxEnd = Math.min(searchEnd, start + 1024);
  const candidateEnds = collectExpandedPathEndCandidates(text, start, maxEnd)
    .filter((candidateEnd) => candidateEnd >= minEnd);

  for (const candidateEnd of candidateEnds) {
    const trimmed = trimToken(text.slice(start, candidateEnd), start, candidateEnd);
    if (!trimmed.value || trimmed.end <= trimmed.start) continue;
    const resolved = resolveExpandedLocalPathCandidate(trimmed.value, context);
    if (!resolved) continue;
    return {
      annotation: {
        kind: resolved.kind,
        source: "plain_path",
        ...buildLinkAnnotationDisplayFields(resolved, trimmed.value),
        raw_text: trimmed.value,
        target: resolved.target,
        open_mode: resolved.openMode,
        start_utf16: trimmed.start,
        end_utf16: trimmed.end,
        line: resolved.line ?? null,
        file_path: resolved.filePath || null,
      },
      end: trimmed.end,
    };
  }
  return null;
}

function isLocalMarkdownHrefCandidate(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  if (hasLeadingUriScheme(normalized)) return false;
  if (normalized.startsWith("#")) return false;
  if (normalized.startsWith("/app/file-preview?")) return true;
  return isPathCandidate(normalized);
}

function isUnsupportedLocalMarkdownHrefCandidate(value, context = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  if (hasLeadingUriScheme(normalized)) return false;
  if (normalized.startsWith("#")) return false;
  if (normalized.startsWith("/sites/")) return false;
  if (isDeprecatedDeliverablesRouteCandidate(normalized)) return false;
  if (normalized.startsWith("/app/file-preview?")) {
    return context.includeAppFilePreviewMarkdown === true;
  }
  return isPathCandidate(normalized);
}

function normalizeMarkdownHrefTarget(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function scanMarkdownLinkAnnotations(text, blockingRanges, context, annotations) {
  MARKDOWN_LINK_RE.lastIndex = 0;
  let match;
  while ((match = MARKDOWN_LINK_RE.exec(text)) !== null) {
    const fullMatch = match[0];
    const start = match.index;
    const end = start + fullMatch.length;
    if (
      isIndexInsideRanges(start, blockingRanges) ||
      isIndexInsideRanges(end - 1, blockingRanges)
    ) {
      continue;
    }

    const displayText = match[1] || "";
    const rawHref = normalizeMarkdownHrefTarget(match[2] || "");
    if (!displayText || !isLocalMarkdownHrefCandidate(rawHref)) {
      continue;
    }

    const resolved = resolveCanonicalTarget(rawHref, context);
    if (!resolved) {
      if (isUnsupportedLocalMarkdownHrefCandidate(rawHref, context)) {
        const unsupported = buildUnsupportedLocalPathResult(rawHref);
        annotations.push({
          kind: unsupported.kind,
          source: "markdown_link",
          ...buildUnsupportedLocalPathDisplayFields(unsupported, rawHref),
          raw_text: fullMatch,
          target: unsupported.target,
          open_mode: unsupported.openMode,
          start_utf16: start,
          end_utf16: end,
          line: null,
          file_path: null,
        });
      }
      continue;
    }

    annotations.push({
      kind: resolved.kind,
      source: "markdown_link",
      ...buildLinkAnnotationDisplayFields(resolved, displayText, {
        preserveMarkdownLabel: true,
      }),
      raw_text: fullMatch,
      target: resolved.target,
      open_mode: resolved.openMode,
      start_utf16: start,
      end_utf16: end,
      line: resolved.line ?? null,
      file_path: resolved.filePath || null,
    });

    if (fullMatch.length === 0) {
      MARKDOWN_LINK_RE.lastIndex += 1;
    }
  }
}

function scanPlainHttpAnnotations(text, segments, annotations) {
  for (const segment of segments) {
    const segmentText = text.slice(segment.start, segment.end);
    HTTP_URL_RE.lastIndex = 0;
    let match;
    while ((match = HTTP_URL_RE.exec(segmentText)) !== null) {
      const rawText = match[0];
      const start = segment.start + match.index;
      const end = start + rawText.length;
      annotations.push({
        kind: "external_url",
        source: "plain_http",
        display_text: rawText,
        raw_text: rawText,
        target: rawText,
        open_mode: "external",
        start_utf16: start,
        end_utf16: end,
      });
      if (rawText.length === 0) {
        HTTP_URL_RE.lastIndex += 1;
      }
    }
  }
}

function collectOccupiedRanges(annotations) {
  return mergeRanges(
    annotations.map((annotation) => ({
      start: annotation.start_utf16,
      end: annotation.end_utf16,
    })),
  );
}

function scanPlainPathAnnotations(text, segments, occupiedRanges, context, annotations) {
  for (const segment of segments) {
    let tokenStart = null;
    for (let index = segment.start; index <= segment.end; index += 1) {
      const isBoundary = index === segment.end || isWhitespaceCharacter(text[index]);
      if (!isBoundary) {
        if (tokenStart === null) {
          tokenStart = index;
        }
        continue;
      }
      if (tokenStart === null) {
        continue;
      }
      const tokenEnd = index;
      const rawToken = text.slice(tokenStart, tokenEnd);
      const trimmed = trimToken(rawToken, tokenStart, tokenEnd);
      tokenStart = null;
      if (!trimmed.value || trimmed.end <= trimmed.start) {
        continue;
      }
      if (trimmed.value === "/") {
        continue;
      }
      if (isIndexInsideRanges(trimmed.start, occupiedRanges) || isIndexInsideRanges(trimmed.end - 1, occupiedRanges)) {
        continue;
      }
      if (!isPathCandidate(trimmed.value)) {
        continue;
      }
      const resolved = resolveCanonicalTarget(trimmed.value, context);
      if (!resolved && isExpandableLocalPathCandidatePrefix(trimmed.value)) {
        const expanded = findExpandedPlainPathAnnotation(
          text,
          trimmed.start,
          trimmed.end,
          segment.end,
          context,
        );
        if (expanded) {
          annotations.push(expanded.annotation);
          occupiedRanges.push({
            start: expanded.annotation.start_utf16,
            end: expanded.annotation.end_utf16,
          });
          index = Math.max(index, expanded.end);
        }
        continue;
      }
      if (!resolved) {
        continue;
      }
      annotations.push({
        kind: resolved.kind,
        source: "plain_path",
        ...buildLinkAnnotationDisplayFields(resolved, trimmed.value),
        raw_text: trimmed.value,
        target: resolved.target,
        open_mode: resolved.openMode,
        start_utf16: trimmed.start,
        end_utf16: trimmed.end,
        line: resolved.line ?? null,
        file_path: resolved.filePath || null,
      });
    }
  }
}

function dedupeAnnotations(annotations) {
  const unique = new Map();
  for (const annotation of annotations) {
    const key = [
      annotation.source,
      annotation.start_utf16,
      annotation.end_utf16,
      annotation.target,
    ].join(":");
    if (!unique.has(key)) {
      unique.set(key, annotation);
    }
  }
  return [...unique.values()].sort((left, right) => left.start_utf16 - right.start_utf16);
}

function collectAttachmentBlockRange(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("[Attached files]")) return [];
  const lines = normalized.split("\n");
  if ((lines[0] || "").trim() !== "[Attached files]") return [];
  let offset = lines[0].length;
  let index = 1;
  while (index < lines.length) {
    const line = lines[index] || "";
    offset += 1 + line.length;
    if (!line.trim()) {
      break;
    }
    index += 1;
  }
  return [{ start: 0, end: offset }];
}

export function buildLinkAnnotations({
  text,
  agentId = "",
  agentRoot = "",
  sourceFilePath = "",
  resolveAgentFolderForSite = null,
  includeAppFilePreviewMarkdown = false,
  allowedRoots = [],
} = {}) {
  const normalizedText = String(text || "");
  if (!normalizedText.trim()) return [];
  const effectiveAgentRoot = agentRoot ? realpathSync(agentRoot) : (sourceFilePath ? findNearestAgentRoot(sourceFilePath) : null);
  const excludedRanges = mergeRanges([
    ...collectExcludedRanges(normalizedText),
    ...collectAttachmentBlockRange(normalizedText),
  ]);
  const segments = collectCandidateSegments(normalizedText, excludedRanges);
  const annotations = [];
  const context = {
    currentAgentId: String(agentId || "").trim(),
    currentAgentRoot: effectiveAgentRoot,
    agentRoot: effectiveAgentRoot,
    sourceFilePath: sourceFilePath ? realpathSync(sourceFilePath) : "",
    resolveAgentFolderForSite,
    includeAppFilePreviewMarkdown,
  };

  scanMarkdownLinkAnnotations(
    normalizedText,
    collectMarkdownLinkBlockingRanges(normalizedText),
    context,
    annotations,
  );
  scanPlainHttpAnnotations(normalizedText, segments, annotations);
  const occupiedRanges = collectOccupiedRanges(annotations);
  scanPlainPathAnnotations(normalizedText, segments, occupiedRanges, context, annotations);
  return dedupeAnnotations(annotations);
}
