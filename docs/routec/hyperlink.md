# Route C Hyperlink Contract

Status: canonical
Updated: 2026-07-02

## Purpose

This document is the canonical Route C hyperlink contract for chat, dashboard
rich text, Mail, Markdown preview, and website surfaces. Older Route C
hyperlink notes defer to this file.

## Target Ownership

Host owns hyperlink classification and stored metadata. Renderers own
presentation, display labels, and click handoff. Stored Matrix bodies,
`formatted_body`, and `link_annotations` are not rewritten to satisfy
presentation behavior.

Supported internal target kinds are:

```text
file_preview_link
directory_link
browser_link
```

`external_url` follows the existing external URL policy. Unsupported local paths
fail closed as text or unavailable state and must not fall through to raw local
browser navigation.

## Desktop Browser Contract

On desktop web, supported Oysterun internal links open a separate browser tab or
window. The source Oysterun page remains in place.

```text
file_preview_link -> File Preview route in a new tab
directory_link    -> Explorer route in a new tab
browser_link      -> direct /sites/<agent_id>/... page in a new tab
```

Desktop `/sites` links must not be wrapped in `/app/browser`. Desktop File
Preview and Explorer links must preserve the validated source/return metadata
used by the generated route while opening that route in a new tab.

Local file and directory links keep the Route C two-click disclosure behavior:
the first click expands the local path text and the second activation performs
the handoff.

## Oysterun App Contract

The Oysterun app keeps supported internal links inside the app-owned surfaces.
Use the existing `isOysterunCapacitorIOSRuntime()` branch only; do not add new
phone, viewport, user-agent, or platform heuristics.

```text
file_preview_link -> in-app File Preview route
directory_link    -> in-app Explorer route
browser_link      -> /app/browser?target=/sites/<agent_id>/...
```

When context is available, `/app/browser` should include `session_id`, `source`,
and `return_path`. A target-only BrowserSurface fallback is allowed only when the
rendering surface has no route context.

## Rendering Contract

Visible labels come from Markdown labels or clean annotation display text.
Opaque bridge labels stay internal. Canonical `data-oysterun-inline-link-*`
attributes remain on supported annotation-backed anchors so delegated click
handlers can route them without inspecting raw text.

P169 punctuation and escape handling remains in force: visible labels must not
leak `oysterun-link-annotation-*`, `\.md`, `\-`, or `\_` artifacts, and literal
non-link backslashes are preserved.

## Documentation Ownership

This file is the source of truth for Route C hyperlink behavior. Historical
files may remain as compatibility pointers for package consumers, but new
requirements, tests, and package references should point at this canonical file.
