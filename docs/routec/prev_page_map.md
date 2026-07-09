# Route C Previous Page Route Map

Route C uses an explicit Previous Page route map for surfaces whose return
destination must be stable across reloads, direct navigation, app restore, and
WebView resume. The topbar and swipe-back handlers consult the route map before
falling back to browser history.

## File Preview

File Preview accepts a validated `return_path` query value. When present and
valid, Previous Page returns to that source route. When it is missing or invalid,
File Preview falls back to the containing Explorer directory for the previewed
file.

Valid `return_path` values must resolve to the current Host origin and to a
known `/app` route. External URLs, `/app/browser`, invalid app paths,
self-referential File Preview routes, and session-scoped return paths for a
different Host session are rejected.

Expected source-aware routes:

- Chat File Preview and Explorer links opened from a committed source message
  return to `/app/sessions/<session_id>/chat?focus_event_id=<event_id>`, where
  `<event_id>` is the closest rendered Matrix event id beginning with `$`.
  The focused return path is materialized at render time onto the final `href`,
  and `data-oysterun-inline-link-target` for local links. Expanded visible text
  remains only the file or folder path; it does not include `return_path`,
  `focus_event_id`, or any query string.
  The original-target metadata remains the Host/base annotation target.
  RoomTimeline does not rewrite `return_path`, `focus_event_id`, `href`, or
  target metadata after render; it owns disclosure/collapse state and the
  existing validated open routing only. Collapsed first-click disclosure stays
  in chat and expands through the RoomTimeline click path. Expanded local links
  open from the current rendered `href` / `data-oysterun-inline-link-target`
  produced by RenderBody. RoomTimeline must not consult the Host/base
  original-target metadata or any secondary open-target field for expanded File
  Preview or Explorer opens. Dashboard Explorer route normalization and URL
  serialization preserve `return_path` so the Explorer Previous Page route can
  return to the source-focused chat route before falling back to the containing
  session chat. Dashboard File Preview route normalization and URL serialization
  preserve explicit `mode=rendered` with source-focused return paths so actual
  opened File Preview URLs remain in the rendered contract. The developer
  ownership pipeline is recorded in
  `docs/routec/dev/chat_local_link_annotation_pipeline.md`.
- Chat File Preview and Explorer links without a committed source message id
  retain the normal chat-level return path.
- Explorer file rows return to the current Explorer route, including session,
  path, and query context.
- Mail detail file links return to the current mail detail route.
- File Preview links to another preview return to the prior File Preview route.
- Direct File Preview routes without `return_path` return to containing Explorer.

The File Preview route map does not depend on browser history for correctness.

## Other Route-Map Owners

Folder picker, mail detail, scheduler log, agent profile, explorer, session loop,
and settings surfaces keep their existing explicit Previous Page behavior. The
P119 File Preview repair does not change the Browser surface `return_path`
contract.
