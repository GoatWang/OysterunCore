# Route C Timeline Display Pagination Model

Status: active dev note for P177

Updated: 2026-07-05

## P177 Live Bottom Alignment Note

`RoomTimeline.tsx` builds a Route C display timeline model from the linked Matrix
timelines before it hands a count and range to `useVirtualPaginator`. The display
model can collapse, hide, or add rows relative to raw Matrix events. Examples
include day dividers, unread dividers, compressed tool groups, compressed tool
placeholders, and hidden renderer-filtered events.

The virtual paginator range is a display range. It must be normalized with
`normalizeRouteCDisplayRange(range, displayItemsLength)` and compared against the
display length for `rangeAtStart` and `rangeAtEnd`. Code that adjusts display
ranges must not assume that one raw Matrix event equals one display row.

When Route C follows the live bottom, live arrivals must refresh the live timeline
source, rebuild the display model, and tail-align the display range to the next
display length. The prior display window size is preserved where possible so the
viewport remains bounded while staying at the live tail.

When the reader is not following latest, live arrivals refresh the model without
changing the range. This preserves scroll-away reading state while still allowing
incoming edits or reactions to render.

Explicit local sends are a separate product behavior: they move to the live
bottom even if the reader had scrolled away. That behavior continues to reset the
timeline through the existing bottom-settle path.

Generic pagination, event-focus pagination, and dense compressed-tool pagination
own their own anchor recalibration. P177 does not change those paths.

Compressed tool placeholder rows are display-model rows with stable source event
identity. They may be present at pagination boundaries or hidden inside compressed
groups. Live-bottom alignment must use display model counts so those rows do not
make the tail placeholders or Jump to Latest control disagree with the actual
scroll state.

## Display Pagination Model

This document explains why Route C pagination and scroll anchoring use display
items instead of treating Matrix event ids or raw Matrix event indexes as direct
pagination targets.

## Background

Original Cinny is built around a mostly simple timeline invariant:

```text
raw Matrix event index ~= virtual item index ~= rendered DOM row
```

With that invariant, appending one live Matrix event can safely shift the visible
range by `+1`, and remote history pagination can preserve scroll position by
using raw event-count offsets.

Route C intentionally breaks that invariant. Oysterun stores product and agent
runtime information in Matrix, but not every stored Matrix event is a normal
chat row. P31 introduced a Route C display timeline model so the UI can render
Oysterun product semantics correctly. P45 then repaired pagination and scroll
anchors after this display model made raw Matrix indexes diverge from UI rows.

Requirement proposal references:

- P31: chat timeline semantic render display items.
- P45: P31 pagination scroll anchor repair.
- P45RB: dense compressed tool boundary and placeholder compatibility.

## Core Contract

Route C has two separate identities:

```text
Matrix event identity:
  Matrix event id / raw Matrix event index
  Used for storage, Matrix fetch, search result source identity, pins, and
  event-level metadata.

Display item identity:
  Route C display item id / display item index
  Used for virtual pagination, DOM row anchoring, scroll restoration, focus,
  and visible timeline range.
```

Matrix event ids remain important, but they are not direct pagination targets.
When a feature starts from a Matrix event id, it must resolve that event id
through the current Route C display model to find the display item that should
be focused or scrolled into view.

The paginator contract is:

```text
paginator count = display item count
timeline.range.start/end = display item indexes
data-message-item = display item index
```

Code that updates `timeline.range` must use display item indexes or an explicit
raw-event-to-display-index mapping. It must not add raw Matrix event counts
directly to display ranges.

## Why Route C Needs Display Items

### Day Dividers

Day dividers such as `Today`, `Yesterday`, or a date label are UI rows. They are
not Matrix events. They are computed from adjacent event timestamps.

If the paginator counts only Matrix events, a day divider creates an extra DOM
row that the raw event index does not know about. Display items make the divider
part of the virtual list, with its own display index and stable display id.

### New Message Dividers

The `New Messages` divider is also a UI row, not a Matrix event. Its position is
derived from read marker/read receipt state.

Without a display item, the visible list can contain a row that has no raw Matrix
event index. This breaks range math, scroll anchors, and focus behavior around
the unread boundary.

### Filtered Semantic Events

Route C Matrix rooms contain Oysterun semantic events such as tool, control, and
provider lifecycle records. Some of them are useful for runtime logic but should
not render as ordinary chat messages.

These events still exist in the raw Matrix timeline. The display model decides
whether they become a visible item, a compressed item, a placeholder, or no UI
row.

### Hidden Provider Lifecycle Events

Provider lifecycle records can represent turn start, streaming state, completion
markers, control outcomes, or other runtime state. These records are not user
chat messages.

Cinny's original chat timeline does not need to model this Oysterun provider
lifecycle stream as product UI. Route C does, so the display model filters or
transforms these events before pagination sees them.

### Redactions

A redacted Matrix event may remain in the raw timeline, but its content is no
longer a normal message. Depending on debug/hidden-event settings, it may not
produce a visible row.

This means raw event count and visible display rows can diverge.

### Reactions And Edits

Reactions and edits are relation events. They should be attached to their target
message, not rendered as independent chat rows.

Route C filters relation events from normal display rows, then renders reaction
and edit state through the target message. Treating each relation event as a
pagination row would produce incorrect chat UI.

### Tool Compression

Tool output can produce many consecutive Matrix events. Showing every tool event
as a full chat row is not usable and can make pagination, rendering, and network
payloads too expensive.

P31 introduced compressed tool display items. P45RB then added frontend-only
compressed tool placeholders so retained tool events still have stable display
anchors.

Important: these placeholders are not synthetic Matrix events. They are display
items only.

The compatibility shape is:

```text
tool Matrix events -> Route C display items

visible compressed tool group:
  user-facing compressed row

compressed tool placeholders:
  hidden frontend-only display items
  one placeholder can preserve the anchor identity for a retained tool event
```

This keeps the UI visually compressed while preserving enough Matrix-event-to-
display-item mapping for pagination, search, pin, and focus.

## Why Cinny Did Not Need This Layer

Cinny's original product surface is normal Matrix chat. Its timeline mostly
renders one message event as one message row, while reactions/edits are handled
as relations attached to a target message.

Because Cinny does not have Oysterun's dense provider lifecycle stream, tool
semantic stream, compressed tool cards, and product-specific hidden runtime
events, it can mostly rely on raw Matrix event indexes for virtual pagination.

Route C cannot rely on that invariant. It has to render product semantics, not
raw Matrix storage rows.

## Pagination And Focus Rules

### Older/Newer Pagination

Matrix history pagination still fetches raw Matrix events. After the linked
Matrix timelines change, Route C must rebuild or read the display model and
recalibrate around a stable display anchor.

Do not preserve the viewport by adding raw Matrix event-count offsets to
`timeline.range`.

### Search, Pin, Reply, And Focus

Search results, pins, replies, and Matrix callbacks often start from a Matrix
event id. That event id is a source identity. Before scrolling, Route C must map
it to the current display item:

```text
Matrix event id -> display item id/index -> DOM row
```

If the event belongs to a compressed tool placeholder, focus behavior may map to
the visible compressed group when that is the user-facing row.

### Live Timeline Updates

Live event arrival must not assume one raw event equals one display item. A live
event can create zero, one, or multiple display items:

- zero display items: filtered semantic/provider event;
- one display item: normal message;
- multiple display items: divider plus message;
- compressed tool behavior: group/placeholder display items.

When the user is following the bottom, the visible range should align to the
display model tail instead of blindly shifting by raw `+1`.

## Non-Goals

This model does not remove Matrix event ids. Matrix event ids remain the durable
source identity for storage, pins, search results, replies, and event metadata.

This model also does not write placeholder events into Matrix. Placeholder rows
are frontend display items only.

The goal is to keep Matrix storage semantics and Route C product rendering
separate:

```text
Matrix timeline = durable source of events
Route C display timeline = product UI pagination and scroll model
```
