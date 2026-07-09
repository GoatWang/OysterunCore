# Route C Hyperlink Rendering Mechanism

Status: active draft for P69+
Updated: 2026-06-10

Canonical source: `docs/routec/hyperlink.md`. This historical mechanism note is
kept for compatibility and must not diverge from the canonical Route C
hyperlink contract.

## Purpose

This document explains how Oysterun creates and renders hyperlinks, especially the relationship between:

```text
1. Host `link_annotations`
2. Markdown link syntax: [label](target)
3. final HTML anchors in chat, Mail, Markdown Preview, and site/browser surfaces
```

## Ownership Boundary

Host owns classification.

Renderer owns presentation.

Stored Matrix / transcript content must not be rewritten just to make links render.

```text
Provider/client visible text
  -> Host scans and attaches link_annotations when supported targets are proven
  -> Matrix event stores body plus link_annotations
  -> Renderer turns body + annotations into visible anchors
  -> click handler routes anchors to the correct Oysterun product surface
```

## Shared Module Contract

Messages, Mail, Markdown File Preview, dashboard rich text, and any other Route
C product surface that renders URLs must share the same link rendering and
internal site-link routing code.

The shared module layer owns:

```text
Markdown link target normalization
Host link annotation bridge recovery
/sites and same-origin Host site URL normalization
local file and directory route target construction
invalid or unsupported local path fail-closed rendering
platform-specific click handoff target selection
```

Render surfaces may pass context into the shared module, such as session id,
agent id, current Host origin, platform, source route, and return path. They
must not fork their own URL parser, Markdown link mapper, `/sites` normalizer,
or local-file click router.

When a new surface needs URL rendering, the required path is to reuse or extend
the shared renderer/link-policy module. Duplicating message-only, Mail-only, or
preview-only link handling is a product inconsistency and should be rejected in
review.

## What Becomes `link_annotations`

Host may attach annotations for supported, proven targets:

```text
existing local file anywhere on the authenticated Host filesystem after stat/realpath proof
existing local directory anywhere on the authenticated Host filesystem after stat/realpath proof
valid /sites/<agent_id>/... site route when resolvable
external http(s) URL where the builder supports external_url classification
```

Route C media captions are also covered text surfaces when the media event is
`m.image`, `m.file`, `m.video`, or `m.audio` and the durable media metadata
field `org.oysterun.media.v1.provider_prompt_user_message` matches the visible
caption body. Host attaches `link_annotations` to the media event content before
Matrix storage, without rewriting `content.body`, `content.msgtype`, or the
media metadata. Filename-only media fallback is not a caption source and must
not be annotated.

Host may attach negative annotations for unsupported local targets when the
renderer needs a no-link classification to suppress raw Markdown fallback:

```json
{
  "kind": "unsupported_local_path",
  "source": "markdown_link",
  "display_text": "/missing/report.md",
  "raw_text": "[Report](/missing/report.md)",
  "target": "/app/unsupported-local-path?path=%2Fmissing%2Freport.md",
  "open_mode": "unsupported"
}
```

Renderers must treat `unsupported_local_path` as a plain-text replacement, not
as a clickable diagnostic link. The diagnostic `target` is retained as Host
metadata, but product text surfaces must render `display_text` /
`path_display_text` without `<a>` and without
`data-oysterun-inline-link-kind`.

Host must fail closed for unsupported targets:

```text
nonexistent local paths
malformed, unreadable, or non-file/non-directory local path candidates
raw local browser href without Host proof
unknown root-relative paths such as /foo/bar
control/lifecycle-only rows
tool.call raw command JSON
private/redacted thinking rows
turn.completed / provider completion marker bodies
```

Agent roots, workspace readable paths, `allowedRoots`, and
`permissions.allowed_paths` do not suppress hyperlink visibility. They remain
provider/tool policy or display/relative-resolution context. Existing local
files still classify as `file_preview_link`, and existing local directories
still classify as `directory_link`, only after Host-side stat/realpath proof.
Absolute local paths may classify even when a live session object is absent.
Relative paths require safe session agent-folder context and fail closed when no
such context is available.

## What Becomes Markdown `[](...)`

There are two different cases.

### Case 1: The model/user already produced Markdown

Example:

```md
[scheduler-store.mjs](/Users/.../scheduler-store.mjs)
```

The Markdown body stays Markdown. Host should scan the Markdown target before Matrix commit. If the target is supported, Host attaches `link_annotations` while preserving the body.

The label should be preserved.

```text
stored body:
  [scheduler-store.mjs](/Users/.../scheduler-store.mjs)

stored metadata:
  link_annotations[0] -> file_preview_link / app route
```

If the Markdown target is an invalid or unsupported local path, Host attaches
`unsupported_local_path` instead. The renderer replaces the whole markdown span
with the target path text:

```text
stored body:
  [Report](/missing/report.md)

stored metadata:
  link_annotations[0] -> unsupported_local_path, display_text /missing/report.md

rendered output:
  /missing/report.md
```

### Case 2: Host annotations exist for plain text

Example stored body:

```text
See /Users/.../scheduler-store.mjs
```

Example stored metadata:

```json
{
  "kind": "file_preview_link",
  "raw_text": "/Users/.../scheduler-store.mjs",
  "target": "/app/file-preview?path=..."
}
```

At render time only, the renderer may convert the annotated span into temporary Markdown input:

```md
See [/Users/.../scheduler-store.mjs](http://<host>/app/sessions/<id>/file-preview?...&__oa_link=0)
```

Then the Markdown parser produces an anchor, and the renderer uses `__oa_link=0` to recover the original annotation and replace the anchor with the correct final app route.

This temporary Markdown source:

```text
is not persisted
is not sent back to Matrix
is not part of transcript truth
exists only to let the Markdown parser render a normal hyperlink
```

## Annotation Bridge

The render-time bridge has three stages:

```text
Before Markdown:
  link_annotations[0] rewrites the raw span into temporary Markdown syntax:
  [label](http://<host>/...&__oa_link=0)

After Markdown:
  renderer finds the produced <a> by temporary marker __oa_link=0

Recovery:
  renderer uses original link_annotations[0] to replace href / target / rel /
  data attributes with the final Oysterun route
```

Unsupported local path annotations do not enter the clickable annotation
bridge. They are rewritten to escaped markdown/plain text before parsing or
rendered directly as a non-anchor text span.

The renderer must not identify annotations by:

```text
visible text matching
path substrings
Markdown HTML structure guesses
file extension
dot-directory names such as .oysterun/site
```

The only valid identity bridge is the annotation index marker created for that render pass.

## P83 Local Path Display Fields

For `file_preview_link` and `directory_link`, Host persists both collapsed and
expanded display text in the annotation. The renderer should use
`collapsed_display_text` as the initial anchor label and keep
`path_display_text` in a data attribute for the first-click reveal. Plain local
paths collapse to the basename, while short human-authored Markdown labels can
be preserved with `path_display_kind: markdown_label_preserved`.

```json
{
  "kind": "file_preview_link",
  "display_text": "report.md",
  "collapsed_display_text": "report.md",
  "path_display_text": "docs/report.md",
  "path_display_kind": "agent_relative",
  "target": "/app/file-preview?path=..."
}
```

The first click on a collapsed local link prevents navigation and swaps the
visible label to `path_display_text`. A second click on the already expanded
link follows the normal File Preview or Explorer route. Escape and message
dead-area clicks collapse expanded local path links. The bridge still uses
annotation index identity; it must not recover links by matching visible labels
or raw path substrings.

## Final Target Mapping

After recovery, targets map as follows:

```text
file_preview_link:
  /app/sessions/<session_id>/file-preview?path=...&mode=rendered

directory_link:
  /app/sessions/<session_id>/explorer?path=...

browser_link / /sites target:
  render-time normalization accepts /sites/... and same-origin http(s)://<current-host>/sites/...
  web desktop: direct /sites/<agent_id>/...
  phone app: /app/browser?target=/sites/<agent_id>/...
             add session_id/source/return_path when source route context exists
             use target-only /app/browser?target=... fallback when context is absent
             top-level target may be HTML, Markdown, or plain text site documents
             CSS/images/binary site assets are not top-level handoff targets

external_url:
  current external URL policy
```

## Click Handler Requirement

Creating an `<a>` is not enough.

Every Route C render surface that displays Oysterun internal links must have a click handoff layer that prevents unsafe default browser behavior.

Required surfaces:

```text
Chat message rendering
Mail body rendering
Markdown File Preview rendering
Dashboard rich text where applicable
```

For local file/directory links, click must not open:

```text
raw /Users/... browser navigation
external Safari
another WebView
the wrong legacy dashboard chat surface
```

For `/sites/...`, the click policy depends on platform:

```text
web desktop:
  direct Host website route

phone app:
  Oysterun internal browser wrapper
  preserve BrowserSurface return context when available
  target-only wrapper fallback may return to the Web tab
```

## Current Implementation Alignment

Known aligned behavior:

```text
RenderBody can consume link_annotations.
RenderBody can create temporary Markdown source with __oa_link bridge.
file_preview_link and directory_link can recover to clean session routes.
Current-session message.user Matrix rows receive Host-side local file,
  directory, /sites browser, and unsupported-local-path annotations while
  preserving stored body text identity.
Route C web-chat owns delegated clicks for
  a[data-oysterun-inline-link-kind] anchors.
Rendered /sites clicks are platform-specific:
  web desktop direct /sites, phone app BrowserSurface wrapper.
Dashboard rich text covers Mail and Markdown File Preview rendered links.
```

Known remaining gaps to verify:

```text
1. Mail and Markdown Preview must still be manually verified as separate render
   surfaces even when they share the dashboard rich-text helper.
2. Generated /sites links must use the Host-known agent id.
```
