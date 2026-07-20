# Oysterun GitHub Tracker

This sample agent checks public GitHub repositories, publishes a daily HTML
report through its Oysterun Website, and sends the same file to Oysterun Mail.

It is safe to copy. The sample contains no GitHub token, Mail credential,
capability token, generated report, runtime state, or machine-local path.

## What It Tracks

Default repositories:

- `anthropics/claude-code`
- `openai/codex`

You can edit `config.json` to add or remove public repositories.

## Run Manually

```bash
uv run tasks/repo_crawler_rich.py --no-mail --days 1
```

The command writes:

```text
.oysterun/site/reports/latest_report.html
```

## Scheduled Run

The sample includes enabled daily scheduler templates at 11:30 Asia/Taipei for
both Codex and Claude.

Scheduler task contracts:

```text
Codex  -> .codex/prompts/scheduler_task.md
Claude -> .claude/commands/scheduler_task.md
```

Both scheduled tasks run:

```bash
uv run tasks/repo_crawler_rich.py --days 1
```

The command also updates `.oysterun/site/index.html` to link the latest report.
When the scheduler run has Oysterun Mail capability, it sends that same report
file through the injected Oysterun product CLI internally.
Do not run a second `oysterun mail send` command after the tracker command
completes.

Do not put secrets in this folder. For higher GitHub API rate limits, set
`GITHUB_TOKEN` in the runtime environment or add your own local-only token
outside the public sample.
