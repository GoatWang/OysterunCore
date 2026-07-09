# Route C Live Bottom Display Range Alignment

Status: active for P177

Updated: 2026-07-05

## Contract

P177 keeps live-bottom following aligned to the Route C display timeline, not to
raw Matrix event counts. A live arrival can add zero, one, or many display items
because hidden events, compressed tool placeholders, grouped tool rows, dividers,
and renderer filtering are display-layer decisions. Bottom-follow code must
therefore tail-align against the next display model instead of incrementing the
range by a raw event delta.

When the viewer is following latest, a live arrival refreshes the live timeline
source, rebuilds the display model, preserves the current display window size,
and clamps the range to the next display tail. This keeps `rangeAtEnd`,
bottom-placeholder rendering, and Jump to Latest visibility consistent with
`displayItemsLength`.

Explicit sends still own the existing send-to-bottom behavior. If the local user
sends while the timeline was not already at the live display end, the timeline is
reset with `getInitialTimeline(room)` and the bottom settle path runs. This is the
product send contract and is not replaced by pagination recalibration.

Non-explicit live arrivals while the reader is scrolled away do not tail-align or
scroll the viewport. They refresh the live timeline source and display model only,
so edits, reactions, and incoming content can render without stealing the reading
position.

Hidden or background bottom settle uses the same display-tail range alignment as
visible bottom follow. If the document is hidden, the follow intent is retained
and the pending settle scroll runs when the document becomes visible again, but
the display range is already aligned to the next display tail.

## Preservation

P177 does not change generic top or bottom pagination, event focus loads,
tool-compression grouping, P45/P45RB dense-tool retry behavior, or compressed
placeholder legitimacy. The display model remains the owner for raw-event to
display-index mapping and for `sourceEventIds` identity.

Bottom placeholders remain legitimate when the display range is not at the live
tail or the loaded timeline is not linked to the live timeline. P177 only removes
the raw `+1` live-arrive mutation that could leave `rangeAtEnd` stale after the
display model changed by a different amount than the raw event stream.
