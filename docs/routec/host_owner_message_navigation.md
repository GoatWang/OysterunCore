# Route C Host Owner Message Navigation

P180 adds Route C Host Owner message neighbor navigation for clean-session chat.
The feature is intentionally scoped to same-room neighbor lookup and timeline
focus, not transcript export.

## Host Endpoint

The Host serves `GET /session/host-owner-message-neighbors` behind the existing
session `can_chat` capability. The request must include `session_id`,
`matrix_room_id`, and either `anchor_event_id` or `anchor_position=latest`.
The route verifies the bound Route C Matrix room before reading storage.

Ownership is derived from committed Matrix event actor metadata:

- `unsigned.routec_matrix_actor_key === "human"`
- `unsigned.routec_matrix_actor_kind === "human"`

Display names, message bodies, and semantic text are not used to decide
ownership. The response returns previous/next event ids, stream sequence values,
boundary flags, and proof metadata only. It does not return raw event payloads,
message bodies, display names, content, or transcript slices.

## Timeline Behavior

The web chat client delays neighbor lookup until the Route C room timeline is
rendered, then chooses an anchor in this order:

1. `focus_event_id` from the clean chat URL.
2. Viewport-center displayed event.
3. Latest visible displayed event.
4. `anchor_position=latest` when no displayed event is available.

Scroll/anchor changes are debounced for a bounded interval and stale responses
are ignored. Only one Host Owner neighbor request is active per room; later
anchors replace a pending request instead of creating parallel lookups. Live
Host Owner arrivals invalidate the lookup by inspecting the same stable actor
metadata on the Matrix event.

## Navigation Path

Previous/next controls are Route C-only and live at the right-bottom edge of
the timeline, above the composer and away from the centered Jump to Latest
control. They expose proof attributes for endpoint, anchor source, placement,
actor source, and disabled/error state.

When a target is selected, the client first dispatches the active
`RoomTimeline.handleOpenEvent/loadEventTimeline` focus command for the current
room. If the active timeline cannot handle it, the existing P154
`handleOpenEvent` path loads the target context and records a clean
`focus_event_id` URL fallback. Generic Matrix `/home/<room>/<event>` navigation
and normal-path `window.location.assign` are not used for Host Owner neighbor
navigation.

## Preservation

P180 preserves generic pagination, explicit-send bottom behavior, non-explicit
scroll-away behavior, legitimate placeholders, P31/P45/P45RB tool-compression
contracts, and the P177 live-bottom display-range alignment. Package
materialization includes this document through the same fail-fast
`docsToInclude`, `ensureFile`, and `copyFileRelative` path used for other Route
C docs.
