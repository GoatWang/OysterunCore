import React from 'react';
import parse, {
  HTMLReactParserOptions,
  attributesToProps,
  domToReact,
} from 'html-react-parser';
import Linkify from 'linkify-react';
import { IntermediateRepresentation, Opts } from 'linkifyjs';
import { MessageEmptyContent } from './content';
import { parseBlockMD, parseInlineMD } from '../../plugins/markdown';
import { sanitizeCustomHtml, sanitizeText } from '../../utils/sanitize';
import { highlightText, scaleSystemEmoji } from '../../plugins/react-custom-html-parser';
import {
  getOysterunHostSessionChatFocusPath,
  getOysterunHostSessionExplorerPathFromTarget,
  getOysterunHostSessionFilePreviewPath,
  normalizeOysterunRouteCSiteBrowserTarget,
} from '../../../oysterun/OysterunHostClient';

export type OysterunLinkAnnotation = {
  kind?: unknown;
  source?: unknown;
  display_text?: unknown;
  collapsed_display_text?: unknown;
  path_display_text?: unknown;
  path_display_kind?: unknown;
  raw_text?: unknown;
  target?: unknown;
  open_mode?: unknown;
  start_utf16?: unknown;
  end_utf16?: unknown;
};

type RenderBodyProps = {
  body: string;
  customBody?: string;
  oysterunLinkAnnotations?: OysterunLinkAnnotation[];
  oysterunSourceEventId?: string;

  highlightRegex?: RegExp;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: Opts;
};

type RenderBodyMemoProps = RenderBodyProps & {
  oysterunLinkAnnotationsMemoSignature: string;
  oysterunSourceEventIdMemoSignature: string;
  highlightRegexMemoSignature: string;
  oysterunHostSessionRouteMemoKey: string;
};

const LEADING_BLOCKQUOTE_HTML_ENTITY_REG = /^(\\*)&gt;/gm;
const MAX_MARKDOWN_BODY_LENGTH = 20000;
const BLOCK_MARKDOWN_REG =
  /(^|\n)(#{1,6} +|>| {0,3}```|.+\|.+\n\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?|(-|\*|[\da-zA-Z]\.) +)/;
// TODO(P313): Keep this Markdown link target allowlist in sync with
// plugins/markdown/inline/rules.ts until the parser exposes a shared predicate.
const INLINE_MARKDOWN_REG =
  /(`[^`\n]+`|\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|\|\|[^|\n]+?\|\||\[[^\]\n]+?\]\((?:https?:\/\/|\/sites\/|\/app\/)[^)\s]+?\))/;
const EMPHASIS_MARKDOWN_REG =
  /(^|[\s([{])(\*[^*\s][\s\S]*?[^*\s]\*|_[^_\s][\s\S]*?[^_\s]_)(?=$|[\s.,!?;:)\]}])/;
const OYSTERUN_LINK_ANNOTATION_INDEX_PARAM = '__oa_link';
const OYSTERUN_LINK_ANNOTATION_BRIDGE_ID_PARAM = '__oa_bridge';
const OYSTERUN_LINK_ANNOTATION_RETURN_PATH_PARAM = 'return_path';
const OYSTERUN_LINK_ANNOTATION_LABEL_PREFIX = 'oysterun-link-annotation';
const MARKDOWN_LINK_LABEL_ESCAPE_REG = /([\\`*_{}\[\]()#+\-.!])/g;
const PARSED_MARKDOWN_LINK_LABEL_ESCAPE_REG = /\\([\\`*_{}\[\]()#+\-.!])/g;
const MARKDOWN_INLINE_CODE_REG = /`[^`\n]+`/g;
const MARKDOWN_FENCED_CODE_REG =
  /(^|\n) {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n {0,3}\2[^\S\n]*(?=\n|$)/gm;

const hasMarkdownSyntax = (body: string): boolean =>
  body.length <= MAX_MARKDOWN_BODY_LENGTH &&
  (BLOCK_MARKDOWN_REG.test(body) ||
    INLINE_MARKDOWN_REG.test(body) ||
    EMPHASIS_MARKDOWN_REG.test(body));

const markdownToCustomHtml = (body: string): string => {
  const sanitizedMarkdown = sanitizeText(body).replace(LEADING_BLOCKQUOTE_HTML_ENTITY_REG, '$1>');
  return parseBlockMD(sanitizedMarkdown, parseInlineMD);
};

const plainTextToHtmlEquivalent = (body: string): string =>
  sanitizeText(body).split('\n').join('<br/>');

const escapeOysterunMarkdownLinkLabel = (value: string): string =>
  value.replace(MARKDOWN_LINK_LABEL_ESCAPE_REG, '\\$1');

const normalizeOysterunParsedMarkdownLinkLabel = (value: string): string =>
  value.replace(PARSED_MARKDOWN_LINK_LABEL_ESCAPE_REG, '$1');

const decodeOysterunAnnotationBridgeHref = (value: string): string =>
  value.replace(/&amp;/g, '&');

const readOysterunAnnotationBridgeLabelIndex = (value: string): number | undefined => {
  const match = new RegExp(`^${OYSTERUN_LINK_ANNOTATION_LABEL_PREFIX}-(\\d+)$`).exec(
    value.trim()
  );
  if (!match) return undefined;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
};

const readOysterunDomText = (nodes: unknown): string => {
  if (!Array.isArray(nodes)) return '';
  return nodes
    .map((node) => {
      if (!node || typeof node !== 'object') return '';
      const candidate = node as { data?: unknown; children?: unknown };
      if (typeof candidate.data === 'string') return candidate.data;
      return readOysterunDomText(candidate.children);
    })
    .join('');
};

const stripOysterunParserOnlyAnchorProps = (
  props: ReturnType<typeof attributesToProps>
): ReturnType<typeof attributesToProps> => {
  const nextProps = { ...props };
  delete (nextProps as Record<string, unknown>)['data-md'];
  delete (nextProps as Record<string, unknown>).target;
  delete (nextProps as Record<string, unknown>).rel;
  return nextProps;
};

const stripOysterunParserOnlyReactAnchorProps = (
  props: Record<string, unknown>
): Record<string, unknown> => {
  const nextProps = { ...props };
  delete nextProps.children;
  delete nextProps['data-md'];
  delete nextProps.target;
  delete nextProps.rel;
  return nextProps;
};

const stripOysterunAnnotationBridgeParams = (targetUrl: URL): string => {
  const stripped = new URL(targetUrl.href);
  stripped.searchParams.delete(OYSTERUN_LINK_ANNOTATION_INDEX_PARAM);
  stripped.searchParams.delete(OYSTERUN_LINK_ANNOTATION_BRIDGE_ID_PARAM);
  stripped.searchParams.delete(OYSTERUN_LINK_ANNOTATION_RETURN_PATH_PARAM);
  return stripped.href;
};

const OYSTERUN_RENDER_BODY_MEMO_FIELD_SEPARATOR = '\u001f';
const OYSTERUN_RENDER_BODY_MEMO_RECORD_SEPARATOR = '\u001e';

const readOysterunRenderBodyMemoScalar = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `string:${value}`;
  if (typeof value === 'number' || typeof value === 'boolean') return `${typeof value}:${value}`;
  return `${typeof value}:${String(value)}`;
};

const buildOysterunLinkAnnotationsMemoSignature = (
  annotations: OysterunLinkAnnotation[] | undefined
): string => {
  if (!Array.isArray(annotations) || annotations.length === 0) return '';
  return annotations
    .map((annotation, index) =>
      [
        index,
        annotation.kind,
        annotation.source,
        annotation.display_text,
        annotation.collapsed_display_text,
        annotation.path_display_text,
        annotation.path_display_kind,
        annotation.raw_text,
        annotation.target,
        annotation.open_mode,
        annotation.start_utf16,
        annotation.end_utf16,
      ]
        .map(readOysterunRenderBodyMemoScalar)
        .join(OYSTERUN_RENDER_BODY_MEMO_FIELD_SEPARATOR)
    )
    .join(OYSTERUN_RENDER_BODY_MEMO_RECORD_SEPARATOR);
};

const buildOysterunHighlightRegexMemoSignature = (highlightRegex: RegExp | undefined): string =>
  highlightRegex ? `${highlightRegex.source}/${highlightRegex.flags}` : '';

const hasOysterunLocalRouteAnnotation = (
  annotations: OysterunLinkAnnotation[] | undefined
): boolean =>
  Array.isArray(annotations) &&
  annotations.some(
    (annotation) =>
      annotation.kind === 'file_preview_link' || annotation.kind === 'directory_link'
  );

const readOysterunRenderBodyCleanSessionRouteFromPathname = (
  pathname: string
): string | undefined => {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 4 || parts[0] !== 'app' || parts[1] !== 'sessions' || parts[3] !== 'chat') {
    return undefined;
  }
  const sessionId = decodeURIComponent(parts[2] ?? '').trim();
  return sessionId ? `clean_session_path:${sessionId}` : undefined;
};

const readOysterunRenderBodyHostSessionRouteMemoKey = (
  annotations: OysterunLinkAnnotation[] | undefined
): string => {
  if (!hasOysterunLocalRouteAnnotation(annotations)) return '';
  if (typeof window === 'undefined') return 'no_window';
  const cleanRoute = readOysterunRenderBodyCleanSessionRouteFromPathname(window.location.pathname);
  if (cleanRoute) return `${window.location.origin}|${cleanRoute}`;
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id')?.trim();
  if (sessionId) return `${window.location.origin}|query_session_id:${sessionId}`;
  const hostSessionId = params.get('host_session_id')?.trim();
  if (hostSessionId) return `${window.location.origin}|query_host_session_id:${hostSessionId}`;
  return `${window.location.origin}|no_host_session_route`;
};

type NormalizedOysterunLinkAnnotation = {
  kind: 'file_preview_link' | 'directory_link' | 'browser_link' | 'external_url' | 'unsupported_local_path';
  source: string;
  displayText: string;
  expandedText?: string;
  pathDisplayKind?: string;
  target: string;
  originalTarget: string;
  start: number;
  end: number;
};

type NormalizedOysterunClickableLinkAnnotationKind = Exclude<
  NormalizedOysterunLinkAnnotation['kind'],
  'unsupported_local_path'
>;

type TextRange = {
  start: number;
  end: number;
};

type OysterunAnnotationBridgeEntry = {
  annotation: NormalizedOysterunLinkAnnotation;
  href: string;
};

type OysterunAnnotationBridge = {
  id: string;
  entries: OysterunAnnotationBridgeEntry[];
};

type OysterunDomChildren = Parameters<typeof domToReact>[0];

type OysterunAnchorDomNode = {
  name: 'a';
  attribs: Record<string, string>;
  children: OysterunDomChildren;
};

const isOysterunRenderableLinkAnnotationKind = (
  value: unknown
): value is NormalizedOysterunLinkAnnotation['kind'] =>
  value === 'file_preview_link' ||
  value === 'directory_link' ||
  value === 'browser_link' ||
  value === 'external_url' ||
  value === 'unsupported_local_path';

const isOysterunClickableLinkAnnotationKind = (
  value: NormalizedOysterunLinkAnnotation['kind']
): value is NormalizedOysterunClickableLinkAnnotationKind =>
  value === 'file_preview_link' ||
  value === 'directory_link' ||
  value === 'browser_link' ||
  value === 'external_url';

const isOysterunUnsupportedLocalPathAnnotationKind = (
  value: NormalizedOysterunLinkAnnotation['kind']
): boolean => value === 'unsupported_local_path';

const isOysterunLocalPathDisclosureLinkKind = (
  value: NormalizedOysterunLinkAnnotation['kind']
): boolean => value === 'file_preview_link' || value === 'directory_link';

const isOysterunCommittedMatrixEventId = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('$');

const resolveOysterunLinkTarget = (
  kind: NormalizedOysterunLinkAnnotation['kind'],
  target: string
): { target: string; kind: NormalizedOysterunLinkAnnotation['kind'] } | undefined => {
  if (kind === 'unsupported_local_path') {
    return { kind, target };
  }
  if (kind === 'file_preview_link') {
    const sessionTarget = getOysterunHostSessionFilePreviewPath(target);
    if (sessionTarget) return { kind, target: sessionTarget };
    return target.startsWith('/app/file-preview?') ? { kind, target } : undefined;
  }
  if (kind === 'directory_link') {
    const sessionTarget = getOysterunHostSessionExplorerPathFromTarget(target);
    if (sessionTarget) return { kind, target: sessionTarget };
    return target.startsWith('/app/explorer?') ? { kind, target } : undefined;
  }
  if (kind === 'external_url') {
    const browserTarget = normalizeOysterunRouteCSiteBrowserTarget(target);
    if (browserTarget) {
      return {
        kind: 'browser_link',
        target: browserTarget,
      };
    }
    try {
      const externalTarget = new URL(target.trim());
      if (externalTarget.protocol === 'https:' || externalTarget.protocol === 'http:') {
        return { kind, target: externalTarget.href };
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  const browserTarget = normalizeOysterunRouteCSiteBrowserTarget(target);
  if (browserTarget) {
    return {
      kind: 'browser_link',
      target: browserTarget,
    };
  }
  return undefined;
};

const withOysterunRenderTimeSourceReturnPath = (
  routeTarget: string,
  kind: NormalizedOysterunLinkAnnotation['kind'],
  sourceEventId: string | undefined
): string => {
  if (!isOysterunLocalPathDisclosureLinkKind(kind)) return routeTarget;
  if (!isOysterunCommittedMatrixEventId(sourceEventId)) return routeTarget;
  if (typeof window === 'undefined') return routeTarget;
  const focusPath = getOysterunHostSessionChatFocusPath(sourceEventId);
  if (!focusPath) return routeTarget;
  let targetUrl: URL;
  try {
    targetUrl = new URL(routeTarget, window.location.origin);
  } catch {
    return routeTarget;
  }
  if (targetUrl.origin !== window.location.origin) return routeTarget;
  targetUrl.searchParams.set('return_path', focusPath);
  return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
};

const getOysterunLinkRouteSurface = (
  kind: NormalizedOysterunLinkAnnotation['kind']
): string | undefined => {
  if (kind === 'browser_link') return 'host_site';
  if (kind === 'file_preview_link') return 'file_preview';
  if (kind === 'directory_link') return 'explorer';
  return undefined;
};

const getOysterunLinkReturnTarget = (
  annotation: NormalizedOysterunLinkAnnotation
): string | undefined => {
  if (annotation.target.startsWith('/app/sessions/')) return 'chat';
  return undefined;
};

const buildOysterunLinkAnchorProps = (annotation: NormalizedOysterunLinkAnnotation) => {
  if (!isOysterunClickableLinkAnnotationKind(annotation.kind)) {
    return {};
  }
  const localPathDisclosure = isOysterunLocalPathDisclosureLinkKind(annotation.kind);
  return {
    href: annotation.target,
    target: annotation.kind === 'external_url' ? '_blank' : undefined,
    rel: annotation.kind === 'external_url' ? 'noreferrer noopener' : undefined,
    title: localPathDisclosure ? annotation.expandedText : undefined,
    'aria-expanded': localPathDisclosure ? false : undefined,
    'data-oysterun-inline-link-kind': annotation.kind,
    'data-oysterun-inline-link-source': annotation.source,
    'data-oysterun-inline-link-target': annotation.target,
    'data-oysterun-inline-link-original-target': annotation.originalTarget,
    'data-oysterun-inline-link-route-surface': getOysterunLinkRouteSurface(annotation.kind),
    'data-oysterun-inline-link-return-to': getOysterunLinkReturnTarget(annotation),
    'data-oysterun-local-path-disclosure': localPathDisclosure ? 'collapsed_first_click' : undefined,
    'data-oysterun-inline-link-collapsed-text': localPathDisclosure
      ? annotation.displayText
      : undefined,
    'data-oysterun-inline-link-expanded-text': localPathDisclosure
      ? annotation.expandedText
      : undefined,
    'data-oysterun-inline-link-path-display-kind': localPathDisclosure
      ? annotation.pathDisplayKind
      : undefined,
    'data-oysterun-inline-link-expanded': localPathDisclosure ? 'false' : undefined,
  };
};

const buildOysterunSiteBrowserAnchorProps = (
  target: unknown,
  source = 'html_anchor'
) => {
  if (typeof target !== 'string') return undefined;
  const browserTarget = normalizeOysterunRouteCSiteBrowserTarget(target);
  if (!browserTarget) return undefined;
  return {
    href: browserTarget,
    target: undefined,
    rel: undefined,
    'data-oysterun-inline-link-kind': 'browser_link',
    'data-oysterun-inline-link-source': source,
    'data-oysterun-inline-link-target': browserTarget,
    'data-oysterun-inline-link-original-target': target,
    'data-oysterun-inline-link-route-surface': 'host_site',
    'data-oysterun-inline-link-return-to': undefined,
  };
};

const readOysterunRenderOrigin = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  return window.location?.origin || undefined;
};

const createOysterunAnnotationBridgeId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const buildOysterunAnnotationBridgeUrl = (
  annotation: NormalizedOysterunLinkAnnotation,
  origin: string
): URL => {
  if (annotation.kind === 'external_url') {
    return new URL('/__oysterun-link-annotation-bridge', origin);
  }
  return new URL(annotation.target, origin);
};

const buildOysterunAnnotationBridgeHref = (
  annotation: NormalizedOysterunLinkAnnotation,
  annotationIndex: number,
  bridgeId: string
): string | undefined => {
  const origin = readOysterunRenderOrigin();
  if (!origin) return undefined;
  let targetUrl: URL;
  try {
    targetUrl = buildOysterunAnnotationBridgeUrl(annotation, origin);
  } catch {
    return undefined;
  }
  if (targetUrl.origin !== origin) return undefined;
  targetUrl.searchParams.set(OYSTERUN_LINK_ANNOTATION_INDEX_PARAM, String(annotationIndex));
  targetUrl.searchParams.set(OYSTERUN_LINK_ANNOTATION_BRIDGE_ID_PARAM, bridgeId);
  return targetUrl.href;
};

const collectMarkdownCodeRangesForAnnotations = (body: string): TextRange[] => {
  const ranges: TextRange[] = [];
  const collect = (pattern: RegExp) => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      if (match[0].length > 0) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
      }
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  };
  collect(MARKDOWN_FENCED_CODE_REG);
  collect(MARKDOWN_INLINE_CODE_REG);
  return ranges.sort((left, right) => left.start - right.start || left.end - right.end);
};

const rangeOverlapsMarkdownCode = (start: number, end: number, codeRanges: TextRange[]): boolean =>
  codeRanges.some((range) => start < range.end && end > range.start);

const filterAnnotationsOutsideMarkdownCode = (
  body: string,
  annotations: NormalizedOysterunLinkAnnotation[]
): NormalizedOysterunLinkAnnotation[] => {
  if (annotations.length === 0) return annotations;
  const codeRanges = collectMarkdownCodeRangesForAnnotations(body);
  if (codeRanges.length === 0) return annotations;
  return annotations.filter((annotation) =>
    !rangeOverlapsMarkdownCode(annotation.start, annotation.end, codeRanges)
  );
};

const readOysterunAnnotationText = (value: unknown): string =>
  typeof value === 'string' && value.length > 0 ? value : '';

const getOysterunAnnotationByTargetAndDisplayText = (
  targetUrl: URL,
  bridge: OysterunAnnotationBridge,
  bridgeLabel: string,
  origin: string
): NormalizedOysterunLinkAnnotation | undefined => {
  const displayText = normalizeOysterunParsedMarkdownLinkLabel(bridgeLabel.trim());
  if (!displayText) return undefined;
  const bridgeEntry = bridge.entries.find((entry) => {
    if (entry.annotation.displayText !== displayText) return false;
    let expectedUrl: URL;
    try {
      expectedUrl = new URL(entry.href, origin);
    } catch {
      return false;
    }
    return (
      targetUrl.origin === expectedUrl.origin &&
      stripOysterunAnnotationBridgeParams(targetUrl) ===
        stripOysterunAnnotationBridgeParams(expectedUrl)
    );
  });
  return bridgeEntry?.annotation;
};

const getOysterunAnnotationByBridgeIndexAndTarget = (
  targetUrl: URL,
  bridge: OysterunAnnotationBridge,
  rawIndex: string | null,
  origin: string
): NormalizedOysterunLinkAnnotation | undefined => {
  if (rawIndex === null) return undefined;
  const annotationIndex = Number(rawIndex);
  if (!Number.isInteger(annotationIndex) || annotationIndex < 0) return undefined;
  const bridgeEntry = bridge.entries[annotationIndex];
  if (!bridgeEntry) return undefined;
  let expectedUrl: URL;
  try {
    expectedUrl = new URL(bridgeEntry.href, origin);
  } catch {
    return undefined;
  }
  if (
    targetUrl.origin !== expectedUrl.origin ||
    stripOysterunAnnotationBridgeParams(targetUrl) !==
      stripOysterunAnnotationBridgeParams(expectedUrl)
  ) {
    return undefined;
  }
  return bridgeEntry.annotation;
};

const getOysterunAnnotationFromBridgeHref = (
  target: unknown,
  bridge: OysterunAnnotationBridge | undefined,
  bridgeLabel = ''
): NormalizedOysterunLinkAnnotation | undefined => {
  if (typeof target !== 'string' || !bridge || bridge.entries.length === 0) return undefined;
  const origin = readOysterunRenderOrigin();
  if (!origin) return undefined;
  let targetUrl: URL;
  try {
    targetUrl = new URL(decodeOysterunAnnotationBridgeHref(target), origin);
  } catch {
    return undefined;
  }
  if (targetUrl.origin !== origin) return undefined;
  const rawIndex = targetUrl.searchParams.get(OYSTERUN_LINK_ANNOTATION_INDEX_PARAM);
  const rawBridgeId = targetUrl.searchParams.get(OYSTERUN_LINK_ANNOTATION_BRIDGE_ID_PARAM);
  const indexedTargetAnnotation = getOysterunAnnotationByBridgeIndexAndTarget(
    targetUrl,
    bridge,
    rawIndex,
    origin
  );
  if (rawBridgeId === bridge.id && indexedTargetAnnotation) {
    return indexedTargetAnnotation;
  }
  if (indexedTargetAnnotation) return indexedTargetAnnotation;

  const displayTextAnnotation = getOysterunAnnotationByTargetAndDisplayText(
    targetUrl,
    bridge,
    bridgeLabel,
    origin
  );
  if (displayTextAnnotation) return displayTextAnnotation;

  const bridgeLabelIndex = readOysterunAnnotationBridgeLabelIndex(bridgeLabel);
  if (bridgeLabelIndex === undefined) return undefined;
  const bridgeEntry = bridge.entries[bridgeLabelIndex];
  if (!bridgeEntry) return undefined;
  let expectedUrl: URL;
  try {
    expectedUrl = new URL(bridgeEntry.href, origin);
  } catch {
    return undefined;
  }
  if (
    targetUrl.origin !== expectedUrl.origin ||
    stripOysterunAnnotationBridgeParams(targetUrl) !==
      stripOysterunAnnotationBridgeParams(expectedUrl)
  ) {
    return undefined;
  }
  return bridgeEntry.annotation;
};

const readOysterunAnchorDomNode = (domNode: unknown): OysterunAnchorDomNode | undefined => {
  if (!domNode || typeof domNode !== 'object') return undefined;
  const candidate = domNode as { name?: unknown; attribs?: unknown; children?: unknown };
  if (candidate.name !== 'a') return undefined;
  if (!candidate.attribs || typeof candidate.attribs !== 'object') return undefined;
  const children = Array.isArray(candidate.children) ? candidate.children : [];
  return {
    name: 'a',
    attribs: candidate.attribs as Record<string, string>,
    children: children as OysterunDomChildren,
  };
};

const renderOysterunAnnotationBridgeAnchor = (
  anchorNode: OysterunAnchorDomNode,
  oysterunAnnotationBridge: OysterunAnnotationBridge | undefined
): React.ReactElement | undefined => {
  const annotation = getOysterunAnnotationFromBridgeHref(
    anchorNode.attribs?.href,
    oysterunAnnotationBridge,
    readOysterunDomText(anchorNode.children)
  );
  if (!annotation) return undefined;
  const props = stripOysterunParserOnlyAnchorProps(
    attributesToProps(anchorNode.attribs)
  );
  return (
    <a {...props} {...buildOysterunLinkAnchorProps(annotation)}>{annotation.displayText}</a>
  );
};

const readOysterunReactNodeText = (node: React.ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(readOysterunReactNodeText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return readOysterunReactNodeText(node.props.children);
  }
  return '';
};

const recoverOysterunAnnotationBridgeReactNode = (
  node: React.ReactNode,
  oysterunAnnotationBridge: OysterunAnnotationBridge
): React.ReactNode => {
  if (Array.isArray(node)) {
    return node.map((child) =>
      recoverOysterunAnnotationBridgeReactNode(child, oysterunAnnotationBridge)
    );
  }
  if (!React.isValidElement<Record<string, unknown>>(node)) return node;
  const props = node.props;
  if (node.type === 'a') {
    const annotation = getOysterunAnnotationFromBridgeHref(
      props.href,
      oysterunAnnotationBridge,
      readOysterunReactNodeText(props.children as React.ReactNode)
    );
    if (annotation) {
      return React.cloneElement(
        node,
        {
          ...stripOysterunParserOnlyReactAnchorProps(props),
          ...buildOysterunLinkAnchorProps(annotation),
        },
        annotation.displayText
      );
    }
  }
  const children = props.children as React.ReactNode;
  if (children === undefined) return node;
  const recoveredChildren = recoverOysterunAnnotationBridgeReactNode(
    children,
    oysterunAnnotationBridge
  );
  if (recoveredChildren === children) return node;
  return React.cloneElement(node, undefined, recoveredChildren);
};

const withOysterunSiteBrowserLinks = (
  htmlReactParserOptions: HTMLReactParserOptions,
  oysterunAnnotationBridge?: OysterunAnnotationBridge
): HTMLReactParserOptions => {
  let wrappedOptions: HTMLReactParserOptions;
  wrappedOptions = {
    ...htmlReactParserOptions,
    replace: (domNode) => {
      const anchorNode = readOysterunAnchorDomNode(domNode);
      if (anchorNode) {
        const annotationAnchor = renderOysterunAnnotationBridgeAnchor(
          anchorNode,
          oysterunAnnotationBridge
        );
        if (annotationAnchor) return annotationAnchor;
        const browserAnchorProps = buildOysterunSiteBrowserAnchorProps(anchorNode.attribs?.href);
        if (browserAnchorProps) {
          const props = attributesToProps(anchorNode.attribs);
          return (
            <a {...props} {...browserAnchorProps}>
              {domToReact(anchorNode.children, wrappedOptions)}
            </a>
          );
        }
      }
      return htmlReactParserOptions.replace?.(domNode);
    },
    transform: (reactNode, domNode, index) => {
      const anchorNode = readOysterunAnchorDomNode(domNode);
      if (anchorNode) {
        const annotationAnchor = renderOysterunAnnotationBridgeAnchor(
          anchorNode,
          oysterunAnnotationBridge
        );
        if (annotationAnchor) return annotationAnchor;
      }
      return htmlReactParserOptions.transform?.(reactNode, domNode, index) ?? reactNode;
    },
  };
  return wrappedOptions;
};

type OysterunRenderedAnchorProps = {
  href?: unknown;
  children?: React.ReactNode;
};

const isOysterunRenderedAnchorElement = (
  element: React.ReactElement
): element is React.ReactElement<OysterunRenderedAnchorProps> =>
  typeof element.type === 'string' && element.type.toLowerCase() === 'a';

const normalizeOysterunRenderedLinks = (
  node: React.ReactNode,
  oysterunAnnotationBridge?: OysterunAnnotationBridge
): React.ReactNode => {
  if (Array.isArray(node)) {
    return node.map((child) => normalizeOysterunRenderedLinks(child, oysterunAnnotationBridge));
  }
  if (!React.isValidElement(node)) return node;

  const element = node as React.ReactElement<{ children?: React.ReactNode }>;
  const normalizedChildren =
    element.props.children === undefined
      ? element.props.children
      : React.Children.map(element.props.children, (child) =>
          normalizeOysterunRenderedLinks(child, oysterunAnnotationBridge)
        );

  if (isOysterunRenderedAnchorElement(element)) {
    const href = element.props.href;
    const annotation = getOysterunAnnotationFromBridgeHref(href, oysterunAnnotationBridge);
    if (annotation) {
      return React.cloneElement(
        element,
        {
          ...element.props,
          ...buildOysterunLinkAnchorProps(annotation),
        },
        annotation.displayText
      );
    }
    const browserAnchorProps = buildOysterunSiteBrowserAnchorProps(href);
    if (browserAnchorProps) {
      return React.cloneElement(
        element,
        {
          ...element.props,
          ...browserAnchorProps,
        },
        normalizedChildren
      );
    }
  }

  if (normalizedChildren === element.props.children) return element;
  return React.cloneElement(element, undefined, normalizedChildren);
};

const withOysterunSiteBrowserLinkifyOptions = (linkifyOpts: Opts): Opts => {
  const originalRender = linkifyOpts.render;
  return {
    ...linkifyOpts,
    render: (ir: IntermediateRepresentation) => {
      const { tagName, attributes, content } = ir;
      if (tagName === 'a') {
        const browserAnchorProps = buildOysterunSiteBrowserAnchorProps(attributes.href, 'linkify');
        if (browserAnchorProps) return <a {...browserAnchorProps}>{content}</a>;
      }
      if (typeof originalRender === 'function') return originalRender(ir);
      if (tagName === 'a') return <a {...attributes}>{content}</a>;
      return content;
    },
  };
};

const buildOysterunAnnotationMarkdownSource = (
  body: string,
  annotations: NormalizedOysterunLinkAnnotation[]
): { markdownSource: string; bridge: OysterunAnnotationBridge } | undefined => {
  const bridgeId = createOysterunAnnotationBridgeId();
  const bridgeEntries: OysterunAnnotationBridgeEntry[] = [];
  const bridgeIndexesByAnnotationIndex = new Map<number, number>();
  let bridgeBuildFailed = false;
  annotations.forEach((annotation, index) => {
    if (!isOysterunClickableLinkAnnotationKind(annotation.kind)) return;
    const href = buildOysterunAnnotationBridgeHref(annotation, index, bridgeId);
    if (!href) {
      bridgeBuildFailed = true;
      return;
    }
    bridgeIndexesByAnnotationIndex.set(index, bridgeEntries.length);
    bridgeEntries.push({ annotation, href });
  });
  if (bridgeBuildFailed) return undefined;
  const bridge: OysterunAnnotationBridge = {
    id: bridgeId,
    entries: bridgeEntries,
  };

  const parts: string[] = [];
  let cursor = 0;
  annotations.forEach((annotation, index) => {
    if (cursor < annotation.start) {
      parts.push(body.slice(cursor, annotation.start));
    }
    if (isOysterunUnsupportedLocalPathAnnotationKind(annotation.kind)) {
      parts.push(escapeOysterunMarkdownLinkLabel(annotation.displayText));
    } else {
      const bridgeIndex = bridgeIndexesByAnnotationIndex.get(index);
      if (bridgeIndex === undefined) {
        return;
      }
      parts.push(
        `[${escapeOysterunMarkdownLinkLabel(annotation.displayText)}](${bridge.entries[bridgeIndex].href})`
      );
    }
    cursor = annotation.end;
  });
  if (cursor < body.length) {
    parts.push(body.slice(cursor));
  }
  return {
    markdownSource: parts.join(''),
    bridge,
  };
};

const renderOysterunAnnotationMarkdownBody = (
  body: string,
  annotations: NormalizedOysterunLinkAnnotation[],
  htmlReactParserOptions: HTMLReactParserOptions,
  linkifyOpts: Opts
) => {
  if (body.length > MAX_MARKDOWN_BODY_LENGTH) return undefined;
  const annotationMarkdown = buildOysterunAnnotationMarkdownSource(body, annotations);
  if (!annotationMarkdown) return undefined;
  const { markdownSource: annotationMarkdownSource, bridge } = annotationMarkdown;
  try {
    const markdownBody = markdownToCustomHtml(annotationMarkdownSource);
    if (markdownBody === plainTextToHtmlEquivalent(annotationMarkdownSource)) {
      return undefined;
    }
    const parsedBody = parse(
      sanitizeCustomHtml(markdownBody),
      withOysterunSiteBrowserLinks(htmlReactParserOptions, bridge)
    );
    return (
      <Linkify options={linkifyOpts}>
        {recoverOysterunAnnotationBridgeReactNode(parsedBody, bridge)}
      </Linkify>
    );
  } catch {
    return undefined;
  }
};

const renderBodyText = (
  value: string,
  key: string,
  htmlReactParserOptions: HTMLReactParserOptions,
  linkifyOpts: Opts,
  highlightRegex?: RegExp
) => {
  if (value === '') return null;
  if (hasMarkdownSyntax(value)) {
    try {
      const markdownBody = markdownToCustomHtml(value);
      if (markdownBody !== plainTextToHtmlEquivalent(value)) {
        const parsedBody = parse(sanitizeCustomHtml(markdownBody), htmlReactParserOptions);
        return (
          <React.Fragment key={key}>
            {normalizeOysterunRenderedLinks(parsedBody)}
          </React.Fragment>
        );
      }
    } catch {
      // Fall back to the original plain-text path for parser edge cases.
    }
  }
  return (
    <Linkify key={key} options={linkifyOpts}>
      {highlightRegex
        ? highlightText(highlightRegex, scaleSystemEmoji(value))
        : scaleSystemEmoji(value)}
    </Linkify>
  );
};

const normalizeOysterunLinkAnnotations = (
  body: string,
  annotations: OysterunLinkAnnotation[] | undefined,
  oysterunSourceEventId: string | undefined
): NormalizedOysterunLinkAnnotation[] => {
  if (!Array.isArray(annotations) || annotations.length === 0) return [];
  const normalized = annotations.flatMap((annotation): NormalizedOysterunLinkAnnotation[] => {
    if (!isOysterunRenderableLinkAnnotationKind(annotation.kind)) return [];
    if (typeof annotation.target !== 'string') return [];
    const resolvedTarget = resolveOysterunLinkTarget(annotation.kind, annotation.target);
    if (!resolvedTarget) return [];
    if (!Number.isInteger(annotation.start_utf16) || !Number.isInteger(annotation.end_utf16)) return [];

    const start = Number(annotation.start_utf16);
    const end = Number(annotation.end_utf16);
    if (start < 0 || end <= start || end > body.length) return [];

    const rawSlice = body.slice(start, end);
    if (typeof annotation.raw_text === 'string' && annotation.raw_text !== rawSlice) return [];

    const displayText = readOysterunAnnotationText(annotation.display_text) || rawSlice;
    const unsupportedLocalPath = isOysterunUnsupportedLocalPathAnnotationKind(resolvedTarget.kind);
    const localPathDisclosure = isOysterunLocalPathDisclosureLinkKind(resolvedTarget.kind);
    const collapsedDisplayText = localPathDisclosure
      ? readOysterunAnnotationText(annotation.collapsed_display_text) || displayText
      : displayText;
    const expandedText = localPathDisclosure
      ? readOysterunAnnotationText(annotation.path_display_text) || displayText
      : undefined;
    const pathDisplayKind = localPathDisclosure
      ? readOysterunAnnotationText(annotation.path_display_kind) || undefined
      : undefined;
    const focusedTarget = withOysterunRenderTimeSourceReturnPath(
      resolvedTarget.target,
      resolvedTarget.kind,
      oysterunSourceEventId
    );
    return [{
      kind: resolvedTarget.kind,
      source: typeof annotation.source === 'string' ? annotation.source : '',
      displayText: unsupportedLocalPath
        ? readOysterunAnnotationText(annotation.path_display_text) || collapsedDisplayText
        : collapsedDisplayText,
      expandedText,
      pathDisplayKind,
      target: focusedTarget,
      originalTarget: annotation.target,
      start,
      end,
    }];
  });
  const outsideMarkdownCode = filterAnnotationsOutsideMarkdownCode(body, normalized);
  outsideMarkdownCode.sort((left, right) => left.start - right.start || left.end - right.end);
  return outsideMarkdownCode.reduce<NormalizedOysterunLinkAnnotation[]>((nonOverlapping, annotation) => {
    const previous = nonOverlapping[nonOverlapping.length - 1];
    if (previous && annotation.start < previous.end) return nonOverlapping;
    nonOverlapping.push(annotation);
    return nonOverlapping;
  }, []);
};

const renderOysterunAnnotatedBody = (
  body: string,
  annotations: NormalizedOysterunLinkAnnotation[],
  htmlReactParserOptions: HTMLReactParserOptions,
  linkifyOpts: Opts,
  highlightRegex?: RegExp
) => {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  annotations.forEach((annotation) => {
    if (cursor < annotation.start) {
      nodes.push(
        renderBodyText(
          body.slice(cursor, annotation.start),
          `text:${cursor}:${annotation.start}`,
          htmlReactParserOptions,
          linkifyOpts,
          highlightRegex
        )
      );
    }
    if (isOysterunUnsupportedLocalPathAnnotationKind(annotation.kind)) {
      nodes.push(
        <span
          key={`${annotation.start}:${annotation.end}:unsupported-local-path`}
          data-oysterun-unsupported-local-path="plain-text"
        >
          {annotation.displayText}
        </span>
      );
      cursor = annotation.end;
      return;
    }
    nodes.push(
      <a
        key={`${annotation.start}:${annotation.end}:${annotation.target}`}
        {...buildOysterunLinkAnchorProps(annotation)}
      >
        {annotation.displayText}
      </a>
    );
    cursor = annotation.end;
  });
  if (cursor < body.length) {
    nodes.push(
      renderBodyText(
        body.slice(cursor),
        `text:${cursor}:${body.length}`,
        htmlReactParserOptions,
        linkifyOpts,
        highlightRegex
      )
    );
  }
  return React.createElement(React.Fragment, null, ...nodes);
};

function RenderBodyInner({
  body,
  customBody,
  oysterunLinkAnnotations,
  oysterunSourceEventId,
  highlightRegex,
  htmlReactParserOptions,
  linkifyOpts,
}: RenderBodyMemoProps) {
  if (body === '') return <MessageEmptyContent />;
  const htmlReactParserOptionsWithSiteLinks =
    withOysterunSiteBrowserLinks(htmlReactParserOptions);
  const linkifyOptsWithSiteLinks = withOysterunSiteBrowserLinkifyOptions(linkifyOpts);
  const normalizedOysterunLinkAnnotations = normalizeOysterunLinkAnnotations(
    body,
    oysterunLinkAnnotations,
    oysterunSourceEventId
  );
  if (normalizedOysterunLinkAnnotations.length > 0) {
    const annotationMarkdownBody = renderOysterunAnnotationMarkdownBody(
      body,
      normalizedOysterunLinkAnnotations,
      htmlReactParserOptions,
      linkifyOptsWithSiteLinks
    );
    if (annotationMarkdownBody) return annotationMarkdownBody;
    return renderOysterunAnnotatedBody(
      body,
      normalizedOysterunLinkAnnotations,
      htmlReactParserOptionsWithSiteLinks,
      linkifyOptsWithSiteLinks,
      highlightRegex
    );
  }
  if (customBody) {
    if (customBody === '') return <MessageEmptyContent />;
    return (
      <>
        {normalizeOysterunRenderedLinks(
          parse(sanitizeCustomHtml(customBody), htmlReactParserOptionsWithSiteLinks)
        )}
      </>
    );
  }
  if (hasMarkdownSyntax(body)) {
    try {
      const markdownBody = markdownToCustomHtml(body);
      if (markdownBody !== plainTextToHtmlEquivalent(body)) {
        return (
          <>
            {normalizeOysterunRenderedLinks(
              parse(sanitizeCustomHtml(markdownBody), htmlReactParserOptionsWithSiteLinks)
            )}
          </>
        );
      }
    } catch {
      // Fall back to the original plain-text path for parser edge cases.
    }
  }
  return (
    <Linkify options={linkifyOptsWithSiteLinks}>
      {highlightRegex
        ? highlightText(highlightRegex, scaleSystemEmoji(body))
        : scaleSystemEmoji(body)}
    </Linkify>
  );
}

const areRenderBodyMemoPropsEqual = (
  prev: RenderBodyMemoProps,
  next: RenderBodyMemoProps
): boolean =>
  prev.body === next.body &&
  prev.customBody === next.customBody &&
  prev.oysterunLinkAnnotationsMemoSignature === next.oysterunLinkAnnotationsMemoSignature &&
  prev.oysterunSourceEventIdMemoSignature === next.oysterunSourceEventIdMemoSignature &&
  prev.highlightRegexMemoSignature === next.highlightRegexMemoSignature &&
  prev.htmlReactParserOptions === next.htmlReactParserOptions &&
  prev.linkifyOpts === next.linkifyOpts &&
  prev.oysterunHostSessionRouteMemoKey === next.oysterunHostSessionRouteMemoKey;

const MemoizedRenderBody = React.memo(RenderBodyInner, areRenderBodyMemoPropsEqual);
MemoizedRenderBody.displayName = 'MemoizedRenderBody';

export function RenderBody(props: RenderBodyProps) {
  return (
    <MemoizedRenderBody
      {...props}
      oysterunLinkAnnotationsMemoSignature={buildOysterunLinkAnnotationsMemoSignature(
        props.oysterunLinkAnnotations
      )}
      oysterunSourceEventIdMemoSignature={readOysterunRenderBodyMemoScalar(
        props.oysterunSourceEventId
      )}
      highlightRegexMemoSignature={buildOysterunHighlightRegexMemoSignature(props.highlightRegex)}
      oysterunHostSessionRouteMemoKey={readOysterunRenderBodyHostSessionRouteMemoKey(
        props.oysterunLinkAnnotations
      )}
    />
  );
}
