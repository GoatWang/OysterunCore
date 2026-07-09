# Route C Chat Local Link Annotation Pipeline

Status: active P175 developer note.

This note records the source-focused local-link contract for Route C chat
messages. It is a developer ownership map, not a new runtime owner.

## Host Base Annotation Ownership

Host owns local-link detection before Matrix commit. It proves local files and
directories, then stores the original message body plus `link_annotations` on
the committed Matrix event. Host annotation targets remain base app routes:

- `file_preview_link` targets a File Preview route with `mode=rendered`.
- `directory_link` targets an Explorer route.
- Unsupported local paths remain non-clickable metadata.

Host does not know the eventual source message focus route. Renderer data
attributes therefore keep Host/base traceability:

```text
data-oysterun-inline-link-original-target -> Host/base annotation target
data-oysterun-inline-link-target          -> final render-time target
href                                      -> final render-time target
```

The original/base target is trace-only for local links after render. Expanded
local File Preview and Explorer opens must not consume it as a fallback when the
rendered `href` is valid.

## Matrix Event Id Context

Source-focused returns require a committed Matrix event id. RoomTimeline reads
the closest rendered message event id and passes it only when it starts with
`$`. Uncommitted, synthetic, missing, or non-Matrix ids must not create fake
focus routes.

The source id path is:

```text
RoomTimeline committed message row
  -> RenderMessageContent oysterunSourceEventId
  -> RenderBody oysterunSourceEventId
  -> render-time local target materialization
```

When the committed id is available, local File Preview and Explorer targets get
a `return_path` to:

```text
/app/sessions/<session_id>/chat?focus_event_id=<committed Matrix event id>
```

When it is unavailable, local links preserve the normal chat-level route and
direct-route fallback behavior.

## Render-Time Materialization

RenderBody owns final source-focused local targets. It normalizes Host/base
annotations into session-scoped routes, appends source-focused `return_path`
only for `file_preview_link` and `directory_link`, and writes the same final
target into both the anchor `href` and
`data-oysterun-inline-link-target`.

File Preview targets must preserve explicit `mode=rendered` while adding the
source-focused return path. Directory Explorer targets must preserve the
directory path and add the source-focused return path.

Expanded visible text remains path-only. It must not include `return_path`,
`focus_event_id`, `mode=rendered`, or any query string.

## RoomTimeline Disclosure Ownership

RoomTimeline owns local path disclosure state and validated open routing only.
Collapsed first click expands the visible path in chat and does not navigate.
Expanded clicks open the current rendered anchor target.

RoomTimeline must not:

- append or rewrite `return_path`;
- append or rewrite `focus_event_id`;
- rewrite `href` or local target metadata after render;
- use MutationObserver resync for local link targets;
- install document-level native capture workarounds;
- add a secondary open-target field;
- fall back to Host/base original-target metadata for expanded local opens;
- add popovers or Open buttons for this flow.

Invalid or missing current `href` values fail closed rather than inventing a
target.

## Route Preservation

Dashboard route serialization preserves the data RenderBody creates:

- Explorer route construction and restore keep `return_path` so Previous Page
  can return to the source-focused chat route.
- File Preview route construction and restore keep both `return_path` and
  explicit `mode=rendered`.

The Previous Page route map remains the owner of fallback behavior. Direct File
Preview or Explorer routes without a valid source-focused `return_path` must not
invent `focus_event_id`.

## Non-Regression Boundaries

This P175 contract preserves:

- P154 focused message routing through `focus_event_id`.
- P169 inline-link data attributes and opaque annotation bridge behavior.
- P173 desktop/app split for internal app routes and external links.
- Browser/site/external link behavior without source-focused local return paths.
- Unsupported local path fail-closed rendering.
- Direct File Preview and Explorer fallback behavior.

## Browser HP Proof Points

The routed human-path proof must show:

- visible login and exactly one proof session;
- visible composer send only;
- a committed `$...` Matrix source event id;
- pre-click local directory and file anchors with source-focused `return_path`
  and nested `focus_event_id`;
- File Preview actual opened URL includes `mode=rendered`;
- original-target metadata remains Host/base-only;
- first-click disclosure stays in chat and expands visible path-only text;
- second-click actual Explorer and File Preview URLs preserve the focused
  return path;
- Previous Page returns to the exact source message row for both surfaces;
- direct routes without a valid return path preserve documented fallback;
- proof session, browser-control, and Host cleanup are complete.
