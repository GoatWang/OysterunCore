# Route C Hyperlink Rendering Rule

Status: active draft for P69+
Updated: 2026-06-10

Canonical source: `docs/routec/hyperlink.md`. This historical rule note is
kept for compatibility and must not diverge from the canonical Route C
hyperlink contract.

## Purpose

This document defines how Oysterun should route rendered hyperlinks in Route C chat, Mail, Markdown preview, and website surfaces.

It separates these dimensions:

```text
1. Platform: web desktop browser vs Oysterun phone app.
2. Target namespace: local file, local directory, Host site, external URL.
3. Source before render: Markdown link syntax vs Host link_annotations.
4. Click route: Oysterun internal product route vs Host site serving vs external URL.
5. Render mode: File Preview rendered mode vs Host website server.
```

## Core Rule

The file extension does not decide the route.

The namespace decides the route:

```text
Existing local file path proven by Host stat/realpath:
  File Preview

Existing local directory path proven by Host stat/realpath:
  Explorer

/sites/<agent_id>/...:
  Host website serving

External http(s):
  External URL policy
```

HTML is not special by itself:

```text
/Users/.../report.html
  is a local file and should render through File Preview rendered mode.

/Users/<agent>/.oysterun/site/reports/report.html
  is still a local file when linked by filesystem path, so it should render through File Preview rendered mode.

/sites/<agent_id>/reports/report.html
  is a Host-served website route and should render through the Host site server.
```

For phone BrowserSurface handoff, a top-level `/sites/...` target may be any
browser-displayable site document such as HTML, Markdown, or plain text. Site
assets such as CSS, images, or arbitrary binary files are subresources, not
top-level BrowserSurface handoff targets.

## Shared Rendering Module Rule

Route C URL rendering must be implemented as shared product code, not as
parallel per-surface rewrites.

The same rendering logic and the same reusable modules must be used anywhere
Oysterun renders message, Mail, Markdown preview, dashboard rich text, or other
product text that can contain URLs, Markdown links, Host site links, or
`link_annotations`.

Required shared behavior:

```text
URL and Markdown target classification
link annotation bridge and display text handling
/sites and same-origin site URL normalization
local file and directory target handling
invalid or unsupported local path fail-closed behavior
platform-specific click handoff
```

The implementation must not duplicate separate URL rendering or click-routing
logic for messages, Mail, Markdown File Preview, or other render surfaces. A
surface may provide context such as session id, source route, platform, or
return path, but it must call the shared renderer/link-policy code for the
actual URL rendering and internal site-link routing.

If a surface cannot use the shared renderer yet, the implementation must record
that as a bounded gap with source evidence and must not silently implement a
new independent URL parser or link router.

## Invalid Local Path Fail-Closed Rule

Invalid or unsupported local path candidates must render as plain text only.
They must not render an `<a>`, must not receive
`data-oysterun-inline-link-kind`, must not open File Preview or Explorer, and
must not fall back to browser navigation.

For invalid Markdown local links, the rendered text is the Markdown target path,
not the markdown label and not the full raw markdown syntax:

```text
[Report](/missing/report.md)
  -> /missing/report.md

[Report](/missing/report.md:12)
  -> /missing/report.md:12
```

For invalid plain local paths, the rendered text remains the path text and is
not promoted to a link:

```text
/missing/report.md
  -> /missing/report.md

/missing/report.md:12
  -> /missing/report.md:12
```

This fail-closed rule includes missing files, missing directories, malformed
local path candidates, unreadable paths, non-file/non-directory targets, and
Host `unsupported_local_path` classifications.

`permissions.allowed_paths`, workspace readable paths, and provider allowed-root
hints are provider/tool execution policy. They are not hyperlink visibility
policy. Hyperlink classification is Host-authenticated and Host-scoped: an
existing local file becomes a File Preview link and an existing local directory
becomes an Explorer link after Host stat/realpath proof, even when the target
is outside the active agent root or configured allowed paths.

Media captions follow the same Host-owned annotation contract when the Matrix
event is `m.image`, `m.file`, `m.video`, or `m.audio` and
`org.oysterun.media.v1.provider_prompt_user_message` contains the visible user
caption. The Host annotates that caption before Matrix persistence and preserves
the media event body, msgtype, filename, URL, and media metadata. A filename-only
body/fallback is not treated as caption text.

## Web Desktop Browser

| Case | Source before render | Example | Expected render | Expected click result on web | Notes |
| --- | --- | --- | --- | --- | --- |
| Local file Markdown link | Markdown | `[a.mjs](/Users/x/a.mjs)` | visible hyperlink | File Preview, preferably `/app/sessions/<id>/file-preview?...` | never raw `/Users/...` browser navigation |
| Local file annotation | `link_annotations` | plain `/Users/x/a.mjs` annotated as `file_preview_link` | visible hyperlink | File Preview | annotation click must be intercepted by Route C web-chat, Mail, or Preview surface |
| Local directory Markdown link | Markdown | `[host-service](/Users/x/host-service)` | visible hyperlink | Explorer, preferably `/app/sessions/<id>/explorer?...` | preserve return-to-chat context when available |
| Local directory annotation | `link_annotations` | plain `/Users/x/host-service` annotated as `directory_link` | visible hyperlink | Explorer | no external browser behavior |
| Host site Markdown link | Markdown | `[report](/sites/agent/reports/a.html)` | visible hyperlink | direct Host-served `/sites/agent/reports/a.html` page in the web browser | do not wrap in `/app/browser` on web desktop |
| Host site annotation | `link_annotations` | `/sites/agent/reports/a.html` annotated as `browser_link` | visible hyperlink | direct Host-served `/sites/...` page in the web browser | do not reinterpret as Explorer asset |
| Host site same-origin absolute URL | Markdown, plain text, or `external_url` annotation | `http://current-host/sites/agent/reports/a.html` | visible hyperlink normalized to `/sites/agent/reports/a.html` at render time | direct Host-served `/sites/...` page in the web browser | only when URL origin equals the current Host origin |
| Missing Host site | Markdown or annotation | `/sites/missing/reports/a.html` | visible hyperlink or unavailable link state | normal Host `/sites` 404/unavailable page | routing cannot make a missing site render |
| Local HTML file | Markdown or annotation | `/Users/x/report.html` | visible hyperlink | File Preview rendered mode | not Host website serving |
| HTML file under `.oysterun/site` linked by local path | Markdown or annotation | `/Users/agent/.oysterun/site/report.html` | visible hyperlink | File Preview rendered mode | namespace is local filesystem path |
| Host-served HTML route | Markdown or annotation | `/sites/agent/report.html` | visible hyperlink | Host website server response | namespace is `/sites` |
| External URL | Markdown or annotation | `https://example.com` | visible hyperlink | normal browser external URL behavior | do not route to File Preview / Explorer |
| Invalid local Markdown link | Markdown | `[Report](/missing/report.md)` | plain `/missing/report.md` text, no anchor | no navigation | fail closed before raw browser fallback |
| Unsupported local annotation | `link_annotations` | `[Report](/outside/report.md)` annotated as `unsupported_local_path` | plain `/outside/report.md` text, no anchor | no File Preview / Explorer / browser fallback | negative classification suppresses raw markdown fallback |
| Unknown root-relative path | Markdown or annotation | `/foo/bar` | only link if Host proves a supported target | unsupported or normal route-specific unavailable state | no unsafe local assumption |

## Oysterun Phone App

| Case | Source before render | Example | Expected render | Expected click result in app | Notes |
| --- | --- | --- | --- | --- | --- |
| Local file Markdown link | Markdown | `[a.mjs](/Users/x/a.mjs)` | visible hyperlink | in-app File Preview, not Safari | click handler must prevent external browser handoff |
| Local file annotation | `link_annotations` | plain `/Users/x/a.mjs` annotated as `file_preview_link` | visible hyperlink | in-app File Preview | same route as web, app-owned surface |
| Local directory Markdown link | Markdown | `[host-service](/Users/x/host-service)` | visible hyperlink | in-app Explorer, not Safari | preserve session context when available |
| Local directory annotation | `link_annotations` | plain `/Users/x/host-service` annotated as `directory_link` | visible hyperlink | in-app Explorer | no Safari |
| Host site Markdown link | Markdown | `[report](/sites/agent/reports/a.html)` | visible hyperlink | Oysterun internal browser wrapper `/app/browser?target=/sites/...` | app uses wrapper because it owns the browser chrome |
| Host site annotation | `link_annotations` | `/sites/agent/reports/a.html` annotated as `browser_link` | visible hyperlink | Oysterun internal browser wrapper | not File Preview |
| Host site same-origin absolute URL | Markdown, plain text, or `external_url` annotation | `http://current-host/sites/agent/reports/a.html` | visible hyperlink normalized to `/sites/agent/reports/a.html` at render time | Oysterun internal browser wrapper | only when URL origin equals the current Host origin; no Safari handoff |
| Missing Host site | Markdown or annotation | `/sites/missing/reports/a.html` | visible hyperlink or unavailable link state | internal browser unavailable page, no Safari | error should be clear |
| Local HTML file | Markdown or annotation | `/Users/x/report.html` | visible hyperlink | in-app File Preview rendered mode | not internal browser wrapper |
| HTML file under `.oysterun/site` linked by local path | Markdown or annotation | `/Users/agent/.oysterun/site/report.html` | visible hyperlink | in-app File Preview rendered mode | namespace is local filesystem path |
| Host-served HTML route | Markdown or annotation | `/sites/agent/report.html` | visible hyperlink | internal browser wrapper renders Host-served site | namespace is `/sites` |
| External URL | Markdown or annotation | `https://example.com` | visible hyperlink | current app external URL policy | do not route to File Preview / Explorer |
| Invalid local Markdown link | Markdown | `[Report](/missing/report.md)` | plain `/missing/report.md` text, no anchor | no in-app browser / Safari fallback | fail closed before raw browser fallback |
| Unsupported local annotation | `link_annotations` | `[Report](/outside/report.md)` annotated as `unsupported_local_path` | plain `/outside/report.md` text, no anchor | no File Preview / Explorer / browser fallback | negative classification suppresses raw markdown fallback |
| Unknown root-relative path | Markdown or annotation | `/foo/bar` | only link if Host proves a supported target | unsupported/unavailable if not resolvable | no Safari fallback for local guesses |

Phone `/sites/...` BrowserSurface routes should preserve source context when
available:

```text
/app/browser?target=/sites/<agent_id>/...&session_id=<id>&source=<surface>&return_path=<app route>
```

If a rendered `/sites/...` link is valid but the render surface has no session
route context, a target-only BrowserSurface fallback is allowed:

```text
/app/browser?target=/sites/<agent_id>/...
```

That fallback must still stay in the Oysterun internal browser and may return
to the default Web tab when Exit Browser cannot derive a source route.

## Site Availability Rule

Routing and availability are separate.

Correct routing for `/sites/<agent_id>/...` does not prove the site exists. If the agent id is not known to the Host or the file is missing under the site root, the correct result is a clear unavailable or 404 state.

The renderer must not convert a missing `/sites/...` route into a local file path guess.

## Local Path Progressive Disclosure

P83 local file and directory annotations render with a two-step click contract.
The stored body and raw Matrix text remain unchanged, while Host persists
presentation metadata beside the link annotation:

```text
collapsed_display_text:
  the default visible text, usually the basename such as report.md or src
path_display_text:
  the full reveal text, agent-relative when possible or absolute when required
path_display_kind:
  agent_relative, absolute, or markdown_label_preserved
```

If the user wrote a short Markdown label such as `[Report](docs/report.md)`,
the collapsed label may remain `Report`; otherwise local paths collapse to the
basename. The first click only reveals `path_display_text`. The second click on
that same expanded link navigates to File Preview or Explorer. Clicking a
message dead area or pressing Escape collapses expanded local path links. This
progressive disclosure applies to local `file_preview_link` and
`directory_link` annotations only; `/sites/...` and external URL behavior is
unchanged.

## Current 9903 Robotaxi Sample Classification

Session:

```text
ccstockworkenv-oysterun-example-068fe
session_id: 0e8931de-c870-46c0-a9f5-c5dc201b92e8
agent_id: ccstockworkenv-oysterun-example
```

Message event:

```text
$routec_05769d9c7270e173da4e3e68eebaed45c368fe62
semantic_type: message.assistant
```

Rendered body includes:

```md
Report: [開啟 Tesla Robotaxi 承諾 vs. 兌現對照](/sites/ccstockworkenv/reports/tesla_robotaxi_timeline.html)

Appendix
- Web Entry Point: /sites/ccstockworkenv/
- Source HTML Preview: .oysterun/site/reports/tesla_robotaxi_timeline.html
```

Actual `link_annotations` only include:

```text
.oysterun/site/reports/tesla_robotaxi_timeline.html
  -> file_preview_link
```

Implications:

```text
1. The /sites/ccstockworkenv/... Markdown link is not currently annotated.
2. Current frontend can still post-process /sites anchors into /app/browser.
3. On web desktop, that wrapper is no longer the desired rule.
4. The /sites target also appears to use the wrong agent id:
   current agent id is ccstockworkenv-oysterun-example, not ccstockworkenv.
```

P69 must distinguish:

```text
site routing bug:
  web desktop should not be forced into /app/browser for /sites links.

site target bug:
  generated /sites URL must use a Host-known agent id.
```
