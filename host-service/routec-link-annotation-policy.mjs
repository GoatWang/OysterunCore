import { buildLinkAnnotations } from "./link-annotations.mjs";

const ROUTEC_PROVIDER_MARKDOWN_LINK_ANNOTATION_SEMANTIC_TYPES = new Set([
  "message.assistant",
  "thinking.reasoning",
]);
const ROUTEC_PROVIDER_MARKDOWN_LINK_ANNOTATION_KINDS = new Set([
  "file_preview_link",
  "directory_link",
  "browser_link",
  "external_url",
  "unsupported_local_path",
]);
const ROUTEC_CHAT_CONTENT_LINK_ANNOTATION_KINDS = new Set([
  "file_preview_link",
  "directory_link",
  "browser_link",
  "unsupported_local_path",
]);
const ROUTEC_LINK_ANNOTATION_BODY_MAX_CHARS = 20000;
const ROUTEC_MEDIA_METADATA_NAMESPACE = "org.oysterun.media.v1";
const ROUTEC_MULTI_MEDIA_MSGTYPE = "org.oysterun.multi_media";
const ROUTEC_MULTI_MEDIA_CONTRACT = "routec_multi_media_product_message_v1";
const ROUTEC_CAPTION_ANNOTATION_MEDIA_MSGTYPES = new Set([
  "m.image",
  "m.file",
  "m.video",
  "m.audio",
]);
const ROUTEC_MEDIA_PROVIDER_PROMPT_USER_MESSAGE_FIELD =
  "provider_prompt_user_message";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getRouteCMediaProviderPromptUserMessage(content) {
  const metadata = isObject(content?.[ROUTEC_MEDIA_METADATA_NAMESPACE])
    ? content[ROUTEC_MEDIA_METADATA_NAMESPACE]
    : null;
  return normalizeNonEmptyString(
    metadata?.[ROUTEC_MEDIA_PROVIDER_PROMPT_USER_MESSAGE_FIELD]
  );
}

function getRouteCMultiMediaCaptionText(content) {
  if (content?.msgtype !== ROUTEC_MULTI_MEDIA_MSGTYPE) return "";
  const metadata = isObject(content?.[ROUTEC_MEDIA_METADATA_NAMESPACE])
    ? content[ROUTEC_MEDIA_METADATA_NAMESPACE]
    : null;
  if (metadata?.contract !== ROUTEC_MULTI_MEDIA_CONTRACT) return "";
  const caption = isObject(metadata.caption) ? metadata.caption : null;
  return normalizeNonEmptyString(caption?.body);
}

function getRouteCMatrixContentAnnotationText(content) {
  if (content?.msgtype === "m.text" && typeof content.body === "string") {
    return content.body;
  }
  const multiMediaCaption = getRouteCMultiMediaCaptionText(content);
  if (multiMediaCaption) return multiMediaCaption;
  if (!ROUTEC_CAPTION_ANNOTATION_MEDIA_MSGTYPES.has(content?.msgtype)) {
    return "";
  }
  const providerPromptUserMessage =
    getRouteCMediaProviderPromptUserMessage(content);
  if (!providerPromptUserMessage || typeof content.body !== "string") {
    return "";
  }
  return content.body.trim() === providerPromptUserMessage ? content.body : "";
}

export function shouldAnnotateRouteCProviderSemanticMarkdownLinks({
  semanticType,
  body,
}) {
  return (
    ROUTEC_PROVIDER_MARKDOWN_LINK_ANNOTATION_SEMANTIC_TYPES.has(
      semanticType
    ) &&
    typeof body === "string" &&
    body.trim().length > 0 &&
    body.length <= ROUTEC_LINK_ANNOTATION_BODY_MAX_CHARS
  );
}

export function buildRouteCMatrixContentAssetLinkAnnotations({
  content,
  agentId = "",
  agentRoot = "",
  workspacePolicy = null,
  assetReadablePaths = [],
}) {
  if (
    content?.msgtype === "m.text" &&
    typeof content.body === "string" &&
    content.body.length > ROUTEC_LINK_ANNOTATION_BODY_MAX_CHARS
  ) {
    return [];
  }
  const annotationText = getRouteCMatrixContentAnnotationText(content);
  if (
    !annotationText.trim() ||
    annotationText.length > ROUTEC_LINK_ANNOTATION_BODY_MAX_CHARS
  ) {
    return [];
  }
  void workspacePolicy;
  void assetReadablePaths;
  return buildLinkAnnotations({
    text: annotationText,
    agentId,
    agentRoot,
    includeAppFilePreviewMarkdown: true,
  }).filter((annotation) =>
    ROUTEC_CHAT_CONTENT_LINK_ANNOTATION_KINDS.has(annotation.kind)
  );
}

export function attachRouteCMatrixContentAssetLinkAnnotations({
  content,
  agentId = "",
  agentRoot = "",
  workspacePolicy = null,
  assetReadablePaths = [],
}) {
  if (!isObject(content)) return content;
  if (
    Array.isArray(content.link_annotations) &&
    content.link_annotations.length > 0
  ) {
    return content;
  }
  const annotations = buildRouteCMatrixContentAssetLinkAnnotations({
    content,
    agentId,
    agentRoot,
    workspacePolicy,
    assetReadablePaths,
  });
  if (annotations.length === 0) return content;
  return {
    ...content,
    link_annotations: annotations,
  };
}

export function attachRouteCProviderSemanticMarkdownLinkAnnotationsForContent({
  content,
  semanticType,
  body,
  agentId = "",
  agentRoot = "",
  workspacePolicy = null,
  assetReadablePaths = [],
}) {
  if (
    !shouldAnnotateRouteCProviderSemanticMarkdownLinks({
      semanticType,
      body,
    })
  ) {
    return content;
  }
  if (!isObject(content)) return content;
  if (
    Array.isArray(content.link_annotations) &&
    content.link_annotations.length > 0
  ) {
    return content;
  }
  if (!agentRoot) return content;
  void workspacePolicy;
  void assetReadablePaths;
  const annotations = buildLinkAnnotations({
    text: body,
    agentId,
    agentRoot,
    includeAppFilePreviewMarkdown: true,
  }).filter((annotation) =>
    ROUTEC_PROVIDER_MARKDOWN_LINK_ANNOTATION_KINDS.has(annotation.kind)
  );
  if (annotations.length === 0) return content;
  return {
    ...content,
    link_annotations: annotations,
  };
}
