#!/usr/bin/env python3
"""
Oysterun GitHub repository report.

Fetches configured GitHub repository updates, writes data/latest_report.html,
and sends the same HTML report to the Host owner through Oysterun Mail.
"""

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from github_tracker import GitHubTracker


PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
PREVIEW_FILE = DATA_DIR / "latest_report.html"
DEFAULT_SOURCE_TYPE = "github_tracker"
DEFAULT_SOURCE_REF = "github-tracker-daily"

VERSION_RE = re.compile(r"(?:^|[^\d])v?(\d+)\.(\d+)\.(\d+)(?:[^\d]|$)", re.IGNORECASE)
SIGNAL_TERMS = [
    ("breaking", "breaking change", 5),
    ("migration", "migration work", 4),
    ("migrate", "migration work", 4),
    ("deprecat", "deprecation", 4),
    ("security", "security impact", 5),
    ("cve-", "security impact", 5),
    ("vulnerability", "security impact", 5),
    ("feature", "new capability", 3),
    ("added", "new capability", 3),
    ("support", "new capability", 3),
    ("implement", "new capability", 3),
    ("enable", "new capability", 3),
    ("api", "API change", 3),
    ("sdk", "SDK change", 3),
    ("architecture", "architecture change", 4),
    ("refactor", "architecture change", 3),
    ("runtime", "runtime/tooling change", 3),
    ("tooling", "runtime/tooling change", 3),
    ("build system", "runtime/tooling change", 3),
    ("performance", "performance change", 3),
    ("perf", "performance change", 3),
    ("protocol", "protocol change", 3),
    ("stable", "project direction", 2),
    ("beta", "project direction", 2),
    ("preview", "project direction", 2),
]
ROUTINE_TERMS = [
    "dependabot",
    "bump ",
    "dependency",
    "dependencies",
    "deps",
    "typo",
    "readme",
    "docs only",
    "format",
    "lint",
    "whitespace",
    "trace",
    "logging",
    "log noise",
    "cleanup",
    "housekeeping",
    "test snapshot",
]
ROUTINE_PREFIXES = (
    "chore",
    "docs",
    "test",
    "tests",
    "ci",
    "style",
    "lint",
)


def load_repos_config() -> dict:
    config_path = PROJECT_ROOT / "config.json"
    if not config_path.exists():
        print(f"ERROR: config.json not found at {config_path}")
        sys.exit(1)
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def fetch_updates(tracker: GitHubTracker, repos_config: dict) -> list:
    print("Checking GitHub repositories for updates...")
    repositories = repos_config.get("repositories")
    if not repositories:
        raise ValueError("No repositories configured in config.json")

    all_updates = []
    errors = []
    for repo_config in repositories:
        owner = repo_config["owner"]
        repo = repo_config["repo"]
        branch = repo_config.get("branch", "main")
        print(f"  Checking {owner}/{repo}...")
        try:
            update = tracker.check_updates(
                owner=owner,
                repo=repo,
                branch=branch,
                track_releases=repo_config.get("track_releases", True),
                track_commits=repo_config.get("track_commits", True),
            )
            if update.has_updates:
                all_updates.append(update)
        except Exception as exc:
            print(f"    ERROR checking {owner}/{repo}: {exc}")
            errors.append(f"{owner}/{repo}: {exc}")

    if errors and len(errors) == len(repositories):
        raise RuntimeError(f"All {len(errors)} repo checks failed: {'; '.join(errors)}")
    return all_updates


def count_totals(updates: list) -> tuple[int, int]:
    releases = sum(len(update.new_releases) for update in updates)
    commits = sum(len(update.new_commits) for update in updates)
    return releases, commits


def generated_timestamp() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z %z")


def strip_markup(text: str) -> str:
    text = re.sub(r"`([^`]*)`", r"\1", text or "")
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"(^|\s)#{1,6}\s+", " ", text)
    text = re.sub(r"[*_>|~-]+", " ", text)
    return " ".join(text.split())


def compact_text(text: str, limit: int = 260) -> str:
    cleaned = strip_markup(text)
    if len(cleaned) <= limit:
        return cleaned
    clipped = cleaned[:limit].rsplit(" ", 1)[0].strip()
    return f"{clipped}..."


def add_reason(reasons: list[str], reason: str) -> None:
    if reason not in reasons:
        reasons.append(reason)


def extract_version(*values: str) -> tuple[int, int, int] | None:
    for value in values:
        match = VERSION_RE.search(value or "")
        if match:
            return tuple(int(part) for part in match.groups())
    return None


def format_github_time(value: str) -> str:
    if not value:
        return "Unknown time"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone().strftime("%Y-%m-%d %H:%M %Z")
    except ValueError:
        return value


def is_routine_text(text: str) -> bool:
    lowered = strip_markup(text).lower()
    if any(term in lowered for term in ROUTINE_TERMS):
        return True
    return any(lowered.startswith(f"{prefix}:") for prefix in ROUTINE_PREFIXES)


def keyword_score(text: str, reasons: list[str]) -> int:
    lowered = strip_markup(text).lower()
    score = 0
    for needle, reason, weight in SIGNAL_TERMS:
        if needle in lowered:
            score += weight
            add_reason(reasons, reason)
    return score


def release_summary(release) -> str:
    lines = []
    for raw_line in (release.body or "").splitlines():
        cleaned = compact_text(raw_line.strip(" -*\t"), 180)
        lowered = cleaned.lower()
        if not cleaned:
            continue
        if lowered in {"what's changed", "changes", "full changelog", "contributors"}:
            continue
        if lowered.startswith("full changelog"):
            continue
        lines.append(cleaned)
        if len(lines) == 2:
            break
    if lines:
        return " ".join(lines)
    fallback = compact_text(release.body or "", 260)
    if fallback:
        return fallback
    if release.name and release.name != release.tag:
        return release.name
    return "Release notes were not provided."


def analyze_release(update, release) -> dict:
    reasons: list[str] = []
    score = 2
    version = extract_version(release.tag, release.name)
    if version:
        major, minor, patch = version
        if major >= 1 and minor == 0 and patch == 0:
            score += 4
            add_reason(reasons, "major version release")
        elif patch == 0:
            score += 2
            add_reason(reasons, "minor feature release")

    signal_text = f"{release.tag} {release.name} {release.body}"
    score += keyword_score(signal_text, reasons)
    if is_routine_text(signal_text) and score <= 4:
        score -= 2

    return {
        "kind": "release",
        "repo": f"{update.owner}/{update.repo}",
        "label": release.tag,
        "title": release.name or release.tag,
        "url": release.html_url,
        "time": format_github_time(release.published_at),
        "summary": release_summary(release),
        "reasons": reasons or ["new release"],
        "score": score,
        "significant": score >= 4,
    }


def analyze_commit(update, commit) -> dict:
    reasons: list[str] = []
    message = commit.message or ""
    lowered = message.lower()
    score = keyword_score(message, reasons)
    if re.match(r"^(feat|feature|add|implement|support|enable|remove|migrate|perf)(\(.+\))?:", lowered):
        score += 3
        add_reason(reasons, "new capability")
    if "!" in message.split(":", 1)[0]:
        score += 4
        add_reason(reasons, "breaking change")
    if lowered.startswith("fix") and any(term in lowered for term in ("security", "crash", "regression", "data loss")):
        score += 3
        add_reason(reasons, "important fix")
    if is_routine_text(message) and score < 4:
        score -= 2

    return {
        "kind": "commit",
        "repo": f"{update.owner}/{update.repo}",
        "label": commit.sha,
        "title": message,
        "url": commit.html_url,
        "time": format_github_time(commit.date),
        "summary": message,
        "author": commit.author,
        "reasons": reasons,
        "score": score,
        "significant": score >= 3,
    }


def analyze_updates(all_updates: list) -> list[dict]:
    analyses = []
    for update in all_updates:
        releases = [analyze_release(update, release) for release in update.new_releases]
        commits = [analyze_commit(update, commit) for commit in update.new_commits]
        notable_commits = [item for item in commits if item["significant"]]
        analyses.append({
            "repo": f"{update.owner}/{update.repo}",
            "release_count": len(update.new_releases),
            "commit_count": len(update.new_commits),
            "releases": releases,
            "notable_commits": notable_commits,
            "routine_commit_count": len(commits) - len(notable_commits),
            "has_notable": any(item["significant"] for item in releases) or bool(notable_commits),
        })
    return analyses


def build_executive_summary(
    repo_analyses: list[dict],
    repositories: list[dict],
    total_releases: int,
    total_commits: int,
    highlights: list[dict],
) -> str:
    if not repo_analyses:
        return (
            f"No new releases or commits were found across {len(repositories)} tracked "
            "repositories during this run."
        )

    changed = len(repo_analyses)
    if highlights:
        top = highlights[0]
        reason = ", ".join(top["reasons"][:2]) or "notable developer-facing change"
        return (
            f"{changed} of {len(repositories)} tracked repositories changed "
            f"({total_releases} releases, {total_commits} commits). The strongest signal is "
            f"{top['repo']} {top['label']}: {reason}. Routine chores and low-signal commits "
            "are summarized rather than expanded below."
        )

    return (
        f"{changed} of {len(repositories)} tracked repositories changed "
        f"({total_releases} releases, {total_commits} commits), but the updates look routine "
        "or maintenance-oriented. No immediate developer action stands out."
    )


def build_mail_summary(
    repo_analyses: list[dict],
    repositories: list[dict],
    total_releases: int,
    total_commits: int,
    highlights: list[dict],
) -> str:
    if not repo_analyses:
        return f"No GitHub updates across {len(repositories)} tracked repositories."
    if highlights:
        top = highlights[0]
        return (
            f"{len(repo_analyses)} repos updated; top signal: {top['repo']} "
            f"{top['label']} ({', '.join(top['reasons'][:2])})."
        )
    return (
        f"{len(repo_analyses)} repos updated with {total_releases} releases and "
        f"{total_commits} commits; no high-signal action needed."
    )


def recommended_action(highlights: list[dict]) -> str:
    if not highlights:
        return ""
    all_reasons = {reason for item in highlights for reason in item["reasons"]}
    if {"breaking change", "migration work", "deprecation", "major version release"} & all_reasons:
        return "Review the linked release notes before upgrading or pulling these changes into dependent work."
    if "security impact" in all_reasons:
        return "Prioritize the security-related update and verify whether any deployed dependency needs a patch."
    if any(item["kind"] == "release" and item["significant"] for item in highlights):
        return "Skim the highlighted release notes for repositories you consume directly."
    return ""


def html_list(items: list[str]) -> str:
    return "".join(f"<li>{item}</li>" for item in items)


def link_or_text(url: str, text: str) -> str:
    safe_url = html.escape(url or "")
    safe_text = html.escape(text or "")
    if not safe_url:
        return safe_text
    return f'<a href="{safe_url}">{safe_text}</a>'


def build_html_report(all_updates: list, repos_config: dict, days: int) -> tuple[str, str]:
    timestamp = generated_timestamp()
    repositories = repos_config["repositories"]
    total_releases, total_commits = count_totals(all_updates)
    repo_analyses = analyze_updates(all_updates)
    highlights = sorted(
        [
            item
            for repo in repo_analyses
            for item in [*repo["releases"], *repo["notable_commits"]]
            if item["significant"]
        ],
        key=lambda item: item["score"],
        reverse=True,
    )
    executive_summary = build_executive_summary(
        repo_analyses,
        repositories,
        total_releases,
        total_commits,
        highlights,
    )
    mail_summary = build_mail_summary(
        repo_analyses,
        repositories,
        total_releases,
        total_commits,
        highlights,
    )

    repo_sections = []
    for repo in repo_analyses:
        parts = [
            '<section class="repo">',
            f"<h2>{html.escape(repo['repo'])}</h2>",
            (
                '<p class="muted">'
                f"{repo['release_count']} release(s), {repo['commit_count']} commit(s) detected"
                "</p>"
            ),
        ]
        if repo["releases"]:
            parts.append("<h3>Releases</h3>")
            for release in repo["releases"]:
                badge = "Notable" if release["significant"] else "Routine"
                item_class = "item signal" if release["significant"] else "item quiet"
                parts.extend([
                    f'<article class="{item_class}">',
                    (
                        '<div class="item-meta">'
                        f"<span class=\"tag\">{html.escape(release['label'])}</span>"
                        f"<span>{html.escape(badge)} release</span>"
                        f"<span>{html.escape(release['time'])}</span>"
                        "</div>"
                    ),
                    f"<h4>{link_or_text(release['url'], release['title'])}</h4>",
                    f"<p>{html.escape(release['summary'])}</p>",
                    f"<p class=\"reasons\">Signal: {html.escape(', '.join(release['reasons']))}</p>",
                    "</article>",
                ])
        if repo["notable_commits"]:
            parts.append("<h3>Notable Commits</h3>")
            parts.append('<ul class="commit-list">')
            for commit in repo["notable_commits"]:
                parts.append(
                    "<li>"
                    f"<code>{html.escape(commit['label'])}</code> "
                    f"{link_or_text(commit['url'], commit['title'])} "
                    f"<span class=\"muted\">by {html.escape(commit['author'])} "
                    f"at {html.escape(commit['time'])}</span>"
                    "</li>"
                )
            parts.append("</ul>")
        if repo["routine_commit_count"]:
            parts.append(
                '<p class="muted">'
                f"{repo['routine_commit_count']} routine commit(s) omitted from the body."
                "</p>"
            )
        if not repo["releases"] and not repo["notable_commits"] and not repo["routine_commit_count"]:
            parts.append("<p>No developer-facing details to expand.</p>")
        parts.append("</section>")
        repo_sections.append("\n".join(parts))

    if not repo_sections:
        repo_sections.append(
            '<section class="repo"><h2>No New Updates</h2>'
            "<p>No release or commit updates were found.</p></section>"
        )

    tracked = html_list(
        [
            f"{html.escape(repo['owner'])}/{html.escape(repo['repo'])}"
            for repo in repositories
        ]
    )
    if highlights:
        highlight_items = html_list(
            [
                (
                    f"<strong>{html.escape(item['repo'])}</strong> "
                    f"{link_or_text(item['url'], item['label'])}: "
                    f"{html.escape(', '.join(item['reasons'][:3]))}. "
                    f"{html.escape(compact_text(item['summary'], 180))}"
                )
                for item in highlights[:6]
            ]
        )
    else:
        highlight_items = "<li>No high-signal developer changes detected in this run.</li>"

    action = recommended_action(highlights)
    action_section = (
        '<section class="panel action"><h2>Recommended Action</h2>'
        f"<p>{html.escape(action)}</p></section>"
        if action
        else ""
    )
    repo_count_without_updates = len(repositories) - len(repo_analyses)

    html_report = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Daily GitHub Update Report</title>
  <style>
    body {{
      margin: 0;
      padding: 24px;
      background: #f4f6f8;
      color: #1d2733;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      line-height: 1.55;
    }}
    main {{
      max-width: 920px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #d8e0ea;
      border-radius: 8px;
      overflow: hidden;
    }}
    header {{
      padding: 28px 32px;
      background: #243244;
      color: #ffffff;
    }}
    h1 {{
      margin: 0 0 8px;
      font-size: 27px;
      letter-spacing: 0;
    }}
    h2 {{
      margin: 0 0 12px;
      font-size: 20px;
      letter-spacing: 0;
    }}
    h3 {{
      margin: 20px 0 10px;
      font-size: 16px;
      letter-spacing: 0;
    }}
    h4 {{
      margin: 8px 0;
      font-size: 16px;
      letter-spacing: 0;
    }}
    a {{
      color: #0b63ce;
      text-decoration: none;
    }}
    a:hover {{
      text-decoration: underline;
    }}
    .content {{
      padding: 28px 32px 34px;
    }}
    .meta {{
      color: #d7dee8;
      margin: 0;
    }}
    .stats {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
      gap: 12px;
      margin: 0 0 24px;
    }}
    .stat {{
      border: 1px solid #d8e0ea;
      border-radius: 6px;
      padding: 14px;
      background: #f8fafc;
    }}
    .number {{
      display: block;
      color: #111827;
      font-size: 24px;
      font-weight: 700;
    }}
    .panel, .repo {{
      border-top: 1px solid #d8e0ea;
      padding-top: 22px;
      margin-top: 22px;
    }}
    .item {{
      border: 1px solid #d8e0ea;
      border-left-width: 4px;
      border-radius: 6px;
      padding: 13px 15px;
      margin: 12px 0;
      background: #ffffff;
    }}
    .signal {{
      border-left-color: #0f766e;
      background: #f5fffb;
    }}
    .quiet {{
      border-left-color: #94a3b8;
      background: #fafbfc;
    }}
    .item-meta {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      color: #5f6b7a;
      font-size: 13px;
    }}
    .tag {{
      display: inline-block;
      background: #e6f2ff;
      color: #064b93;
      border-radius: 999px;
      padding: 2px 9px;
      font-size: 12px;
      font-weight: 700;
    }}
    .muted, .reasons {{
      color: #667085;
      font-size: 13px;
    }}
    .commit-list {{
      padding-left: 20px;
    }}
    .commit-list li {{
      margin: 8px 0;
    }}
    code {{
      background: #eef2f7;
      border-radius: 4px;
      padding: 2px 5px;
    }}
    .action {{
      border-left: 4px solid #b45309;
      padding-left: 16px;
      background: #fffaf0;
      padding-bottom: 1px;
    }}
    footer {{
      margin-top: 28px;
      color: #667085;
      font-size: 12px;
    }}
    @media (max-width: 640px) {{
      body {{
        padding: 0;
      }}
      main {{
        border-radius: 0;
        border-left: 0;
        border-right: 0;
      }}
      header, .content {{
        padding-left: 18px;
        padding-right: 18px;
      }}
    }}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Daily GitHub Update Report</h1>
      <p class="meta">Generated {html.escape(timestamp)} | Lookback: {days} day(s)</p>
    </header>
    <div class="content">
      <div class="stats">
        <div class="stat"><span class="number">{len(repositories)}</span>Tracked repos</div>
        <div class="stat"><span class="number">{len(repo_analyses)}</span>Repos with updates</div>
        <div class="stat"><span class="number">{total_releases}</span>New releases</div>
        <div class="stat"><span class="number">{total_commits}</span>Recent commits</div>
      </div>

      <section class="panel">
        <h2>Executive Summary</h2>
        <p>{html.escape(executive_summary)}</p>
      </section>

      <section class="panel">
        <h2>Key Highlights</h2>
        <ul>{highlight_items}</ul>
      </section>

      {action_section}

      <section class="panel">
        <h2>Repository Details</h2>
        {''.join(repo_sections)}
      </section>

      <section class="panel">
        <h2>Coverage</h2>
        <p>{repo_count_without_updates} tracked repo(s) had no release or commit updates in this run.</p>
        <ul>{tracked}</ul>
      </section>

      <footer>Generated by GitHub Tracker and delivered through Oysterun Mail.</footer>
    </div>
  </main>
</body>
</html>
"""
    return html_report, mail_summary


def write_preview(html_report: str) -> Path:
    DATA_DIR.mkdir(exist_ok=True)
    PREVIEW_FILE.write_text(html_report, encoding="utf-8")
    return PREVIEW_FILE


def snapshot_state_file() -> tuple[bool, bytes]:
    state_file = DATA_DIR / "github_tracking_state.json"
    if not state_file.exists():
        return False, b""
    return True, state_file.read_bytes()


def restore_state_file(snapshot: tuple[bool, bytes]) -> None:
    state_file = DATA_DIR / "github_tracking_state.json"
    existed, content = snapshot
    if existed:
        DATA_DIR.mkdir(exist_ok=True)
        state_file.write_bytes(content)
    else:
        state_file.unlink(missing_ok=True)


def oysterun_cli_base() -> list[str]:
    cli_bin = os.environ.get("OYSTERUN_CLI_BIN", "").strip()
    if cli_bin:
        if cli_bin.endswith(".mjs"):
            node_bin = os.environ.get("OYSTERUN_NODE_BIN", "").strip() or shutil.which("node")
            if not node_bin:
                raise RuntimeError("OYSTERUN_CLI_BIN is an .mjs file but node was not found")
            return [node_bin, cli_bin]
        return [cli_bin]

    oysterun_bin = shutil.which("oysterun")
    if oysterun_bin:
        return [oysterun_bin]
    raise RuntimeError("OYSTERUN_CLI_BIN is not set and oysterun is not on PATH")


def send_oysterun_mail(title: str, report_file: Path, summary: str, source_ref: str) -> None:
    if report_file.suffix.lower() != ".html":
        raise RuntimeError(f"Oysterun Mail deliverable must be a .html file: {report_file}")
    if not report_file.exists() or report_file.stat().st_size <= 0:
        raise RuntimeError(f"Oysterun Mail deliverable is missing or empty: {report_file}")
    env = os.environ.copy()
    env.pop("OYSTERUN_CLI_TEXT", None)
    cmd = oysterun_cli_base() + [
        "mail",
        "send",
        "--title",
        title,
        "--summary",
        summary,
        "--html-file",
        str(report_file),
        "--source-type",
        DEFAULT_SOURCE_TYPE,
        "--source-name",
        "GitHub Tracker",
        "--source-ref",
        source_ref,
    ]
    schedule_run_id = os.environ.get("OYSTERUN_SCHEDULE_RUN_ID", "").strip()
    if schedule_run_id:
        cmd.extend([
            "--idempotency-key",
            f"githubtracker-{schedule_run_id}-{datetime.now().strftime('%Y-%m-%d')}",
        ])
    result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(f"Oysterun Mail send failed with exit code {result.returncode}")
    print("Oysterun Mail sent to Host owner with HTML report file.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate and mail GitHub updates via Oysterun Mail")
    parser.add_argument("--days", type=int, default=1, help="Number of days to look back for commits")
    parser.add_argument("--no-mail", action="store_true", help="Generate report without sending Oysterun Mail")
    parser.add_argument("--title", default="", help="Override Oysterun Mail title")
    parser.add_argument("--source-ref", default=DEFAULT_SOURCE_REF, help="Oysterun Mail source reference")
    args = parser.parse_args()

    repos_config = load_repos_config()
    github_token = repos_config.get("github_token") or os.environ.get("GITHUB_TOKEN")
    if not github_token:
        print("WARNING: No GitHub token found. API rate limit is 60 req/hr.")

    state_snapshot = snapshot_state_file()
    state_file = DATA_DIR / "github_tracking_state.json"
    tracker = GitHubTracker(state_file=state_file, github_token=github_token, days=args.days)
    all_updates = fetch_updates(tracker, repos_config)
    html_report, mail_summary = build_html_report(all_updates, repos_config, args.days)
    preview_file = write_preview(html_report)
    total_releases, total_commits = count_totals(all_updates)
    print(f"Preview saved to: {preview_file}")
    print(
        "Report stats: "
        f"{len(repos_config['repositories'])} repo(s) tracked, "
        f"{len(all_updates)} with updates, "
        f"{total_releases} release(s), {total_commits} commit(s)."
    )

    if args.no_mail:
        restore_state_file(state_snapshot)
        print("Oysterun Mail send skipped because --no-mail was supplied.")
        print("Tracker state restored because this was a no-mail preview run.")
        return

    title = args.title or f"GitHub Updates Report - {datetime.now().strftime('%Y-%m-%d')}"
    try:
        send_oysterun_mail(title, preview_file, mail_summary, args.source_ref)
    except Exception:
        restore_state_file(state_snapshot)
        print("Tracker state restored because Oysterun Mail send failed.", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
