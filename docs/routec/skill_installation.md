# Route C Oysterun Skill Installation

Status: Phase 181 runtime/package source contract.

Oysterun installs one aggregate provider skill set into the selected provider's
skill root:

```text
<provider_skill_root>/Oysterun/SKILL.md
<provider_skill_root>/Oysterun/modules/<product-skill>/SKILL.md
```

Supported provider roots are:

| Provider | Root |
| --- | --- |
| Claude | `.claude/skills` |
| Codex | `.codex/skills` |

## Runtime Source

Installed Host runtime uses the packaged aggregate skill source:

```text
host-service/assets/product-skills/Oysterun/
```

Runtime status and install must not require repository-only development roots:

```text
skills/
.codex/skills/
```

Those development roots remain mirror/source parity inputs for source-static and
package verification. They are not an installed runtime precondition.

## Ownership And Copy Rules

The aggregate `Oysterun/SKILL.md` must contain:

```text
<!-- oysterun-skill-set: true -->
```

Install behavior is fail-closed:

- missing `Oysterun` folder: install is allowed
- existing marker-owned `Oysterun` folder: overwrite is allowed only when the
  caller explicitly requests update/overwrite
- existing unowned `Oysterun` folder: overwrite is refused
- package source must include every expected product-skill module `SKILL.md`
- copy refuses symlinks, non-file entries, and target paths outside the selected
  agent folder

## UI Surfaces

Session Setup exposes the launch-time `Install/Overwrite Oysterun Skills`
checkbox. Missing skills default to checked. Existing marker-owned skills default
to unchecked and overwrite only when checked. Existing unowned folders disable
the checkbox.

Session Profile exposes `Install/Update Oysterun Skills` for the selected live
session. The action checks status first, installs when missing, and asks for
confirmation before overwriting an existing marker-owned Oysterun skill set. It
does not mutate `.oysterun/config.json`.

Host Preferences does not expose provider skill install/update controls.

## Slash Command

`/install_oysterun_skill` is intercepted by Host before provider delivery. It is
never sent to Claude, Codex, or another provider as a prompt.

In the Route C visible composer, typed and autocomplete-inserted
`/install_oysterun_skill` commands are sent as exact local-command Matrix bodies.
The composer preserves `--update`, `update`, `--overwrite`, and `overwrite`
tokens and suppresses Markdown formatted-body rewriting for this command so Host
can intercept it before provider delivery.

After Host intercepts the exact Matrix body, it writes browser-visible local outcome
evidence tied to the same Matrix source event. The outcome records the install or
update result as local Host evidence and includes `Provider delivery suppressed`
semantics; it is not an ordinary provider-delivered `message.user` response.

## P183/P307 Runtime Authority Alignment

P183/P307 runtime authority alignment makes installed Oysterun product skill
commands use the live-session product runtime capability environment instead of
dashboard login.

The installed Oysterun skill set is not a dashboard-login bootstrap. In a live
Host session, every installed Oysterun product skill command uses Host-injected
runtime capability environment instead of asking the agent to run
`oysterun auth login`. The Host validates that the runtime token came from a
currently live source session and then authorizes installed Oysterun product
commands with Host-wide product authority. Current-session env values are
defaults for omitted parameters, not cross-session restrictions. Dashboard auth
is preserved for Session Setup, provider skill installation/update,
dashboard/admin operations, provider auth, credentials, raw config editing, and
external operator shells without live-session runtime env.

Runtime product skill commands keep the existing P86 safety shape: no direct
Host endpoint calls from skill instructions, no raw token output, redacted JSON
responses, and `--dry-run` / `--confirm` for destructive or externally visible
mutations. Runtime capability toggles are not normal CLI behavior. Packaged runtime source remains
`host-service/assets/product-skills/Oysterun/`; development mirrors remain a
source/build parity check.

The command installs a missing aggregate set. To overwrite an existing owned set,
include one of:

```text
--overwrite
overwrite
--update
update
```

Unowned existing folders remain refused.

## Endpoints

Read-only status:

```text
GET /agent/provider-skill-status?agent_id=<id>&agent_folder=<path>&provider=<provider>
```

Profile install/update:

```text
POST /agent/provider-skill-install
```

Required body fields:

```json
{
  "agent_id": "agent-id",
  "agent_folder": "/path/to/agent",
  "provider": "claude",
  "overwrite": false
}
```

`overwrite: true` is required for marker-owned existing folders. The endpoint is
not a general provider-skill mutation API.
