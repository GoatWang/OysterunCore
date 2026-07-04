# Oysterun

<!-- oysterun-skill-set: true -->

This aggregate skill set exposes Oysterun product skills to a provider skill
folder. It is installed by the Host P88 provider skill installation controller
with copy-only semantics.

Canonical module skill sources live in `skills/oysterun-*`. This aggregate keeps
provider-facing module entries under `Oysterun/modules/` so helper slash commands
can insert stable relative paths such as:

```text
@.codex/skills/Oysterun/modules/oysterun-notifications/SKILL.md
@.claude/skills/Oysterun/modules/oysterun-notifications/SKILL.md
```

## Modules

- `modules/oysterun-sessions/SKILL.md`
- `modules/oysterun-session-chat/SKILL.md`
- `modules/oysterun-find-context/SKILL.md`
- `modules/oysterun-scheduler/SKILL.md`
- `modules/oysterun-mail/SKILL.md`
- `modules/oysterun-notifications/SKILL.md`
- `modules/oysterun-website/SKILL.md`
- `modules/oysterun-telegram/SKILL.md`

Do not remove the ownership marker above. The Host refuses to overwrite an
existing `Oysterun` provider skill folder unless this marker is present.
