# Route C Tool Message Transfer Compression

P131 keeps retained Matrix tool event identity while reducing normal timeline
transfer size. Large `tool.call`, `tool.output`, `tool.result`, and
`tool.failure` payloads are projected into a bounded summary before they leave
the Host through normal timeline delivery.

Normal delivery surfaces include Matrix `/sync`, stale incremental catch-up,
initial sync, `/rooms/:roomId/messages`, `/rooms/:roomId/event/:eventId`,
Matrix search result events, product transcript reads, and session setup
transcript preview. These surfaces must preserve `event_id`, `room_id`,
`sender`, `origin_server_ts`, stream ordering, pagination identity, and frontend
`sourceEventIds` mapping.

Full tool detail is available only after explicit detail navigation through:

```text
GET /session/tool-event-detail?session_id=...&matrix_room_id=...&matrix_event_id=...
```

The endpoint is authenticated, requires the session's Matrix room binding to
match the requested room, and fails closed for missing, cross-room,
unavailable, or ambiguous detail. Responses must not expose raw Host-local
storage paths.

P143 keeps explicit detail expansion source-selectable. Detail page 1 may use
the authenticated P131 retained-detail endpoint for projected `tool.result` and
`tool.failure` rows; when that endpoint is selected, retained Matrix summaries
must not mask loading, empty, or error states. The selected detail response is a
top-only 1 MiB selected detail with truncation metadata. Any source metadata for
verification is gated by `debug_routec_tool_detail_source_ui_enabled` and is
limited to the explicit expansion surface, not collapsed chat rows.

P176 keeps `tool.call` Matrix bodies useful when the same event carries tool
input but no explicit body. Explicit body fields remain authoritative. When the
semantic type is exactly `tool.call` and those explicit body candidates are
empty, the Host derives a bounded Matrix body from same-event `tool_input`
first, then `input`. Command-shaped input starts with the command string and
adds `cwd` only when useful; non-command input such as patch changes or
arbitrary provider input is summarized as bounded JSON/text without requiring a
command. If no useful input is present, useful `tool_name`/`name` and
`tool_call_id`/`call_id`/`id` metadata may form the body. The final fallback
remains the literal `tool.call` only when no useful same-event input or metadata
exists. Generated bodies must stay bounded, serialization-fail-closed, and safe
for Matrix body surfaces: they must not expose access tokens, cookies,
authorization headers, raw Host-local storage paths, or raw `large_tool_calls`
paths. This rule does not change `tool.output`, `tool.result`, or
`tool.failure` body/projection behavior.

P153 keeps tool display grouping frontend-only. Continuous `tool.call`,
`tool.output`, `tool.result`, and `tool.failure` Matrix events for the same
tool run are treated as one ordered semantic stream and displayed as flat
10-message pages. The collapsed row uses the first-message-body from that page
only; an empty first body remains empty and does not fall back to later
non-empty events, selected detail, result/failure preference, or raw payload
preview.

P153 does not change P131 detail ownership. Opening a tool page keeps the flat
Matrix page visible in original event order. P131 selected detail may be fetched
and surfaced as row-scoped metadata, but it must not replace, blank, reorder, or
hide the flat 10-message page. This preserves Matrix event identity,
`sourceEventIds`, raw-event-to-display mappings, and reentry/focus behavior.

P131 does not replace P82/P142. P82/P142 still keeps the first 10 continuous
tool semantic events as Matrix-retained events and spills event 11+ to
`large_tool_calls` JSONL with explicit continuation navigation. JSONL
continuation pages expose at most 10 tool events per visible page.

The P153 retained page must pass the same raw `provider_turn_id` or
`target_turn_id` grouping key that the Host writes into the `large_tool_calls`
index. `session_id` and `matrix_room_id` remain separate request parameters for
the `/session/large-tool-output` resolver; the frontend must not prefix them
into `grouping_key`.

P132 Matrix sync budgeting runs after this projection. `/sync` and `/messages`
budget diagnostics may count projected client-transfer bytes and omitted event
counts, but they must not re-inline full tool detail, bypass
`/session/tool-event-detail`, or alter P82 spillover ownership.

P135 Sessions-page reentry repair also runs after this projection. It may split
large Matrix `/sync` or `/messages` transfer pages by projected response bytes,
but it must preserve `event_id`, pagination checkpoints, explicit detail
navigation, and the P131 rule that full tool payloads are available only through
`/session/tool-event-detail`.

P135 active-run semantic bridge pacing is separate from projection. It batches
durable storage commits for provider/tool semantic events but still writes each
retained event through the P82/P131 path. It must not drop, truncate, or raw-log
provider/tool payloads, and it must not replace explicit
`/session/tool-event-detail` navigation with inline full detail transfer.
Pacing stays active by default; proof-only diagnostics for pacing and Matrix
transfer budgets are emitted only when `config.debug.json` enables
`debug_routec_chat_liveness_diagnostics_enabled`.
