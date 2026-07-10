"""
GitHub Repository Tracker Library

Reusable utilities for tracking GitHub repository updates (releases, commits, tags).
Uses GitHub REST API v3.
"""

import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError
from urllib.request import Request, urlopen


@dataclass
class Release:
    """GitHub release information."""
    tag: str
    name: str
    published_at: str
    html_url: str
    body: str  # Release notes


@dataclass
class Commit:
    """GitHub commit information."""
    sha: str
    message: str
    author: str
    date: str
    html_url: str


@dataclass
class RepoUpdate:
    """Update information for a repository."""
    owner: str
    repo: str
    new_releases: list[Release]
    new_commits: list[Commit]
    has_updates: bool


class GitHubTracker:
    """Track GitHub repository updates using REST API."""

    def __init__(self, state_file: Path, github_token: Optional[str] = None, days: int = 1):
        """
        Initialize tracker.

        Args:
            state_file: Path to JSON file storing last-checked state
            github_token: Optional GitHub token for higher rate limits
            days: Number of days to look back for commits (default: 1)
        """
        self.state_file = state_file
        self.github_token = github_token
        self.days = days
        self.state = self._load_state()

    def _load_state(self) -> dict:
        """Load tracking state from file."""
        if self.state_file.exists():
            try:
                with open(self.state_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except json.JSONDecodeError:
                print(f"WARNING: Corrupt state file {self.state_file}, resetting")
                return {}
        print(f"INFO: No state file found at {self.state_file}, starting fresh")
        return {}

    def _save_state(self):
        """Save tracking state to file."""
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.state_file, "w", encoding="utf-8") as f:
            json.dump(self.state, f, indent=2)

    def _api_request(self, url: str) -> dict | list:
        """Make GitHub API request with authentication if available."""
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "JeremyAgentTasks-GitHubTracker",
        }

        if self.github_token:
            headers["Authorization"] = f"token {self.github_token}"

        req = Request(url, headers=headers)

        try:
            with urlopen(req, timeout=10) as response:
                return json.loads(response.read().decode())
        except HTTPError as e:
            if e.code == 404:
                return []  # Repo not found or no releases
            raise

    def _get_repo_state(self, owner: str, repo: str) -> dict:
        """Get stored state for a repository."""
        key = f"{owner}/{repo}"
        if key not in self.state:
            self.state[key] = {
                "last_release_tag": None,
                "last_commit_sha": None,
                "last_checked": None,
            }
        return self.state[key]

    def _update_repo_state(self, owner: str, repo: str, **updates):
        """Update stored state for a repository."""
        key = f"{owner}/{repo}"
        state = self._get_repo_state(owner, repo)
        state.update(updates)
        state["last_checked"] = datetime.now().isoformat()
        self._save_state()

    def get_latest_release(self, owner: str, repo: str) -> Optional[Release]:
        """Get the latest release for a repository."""
        url = f"https://api.github.com/repos/{owner}/{repo}/releases/latest"

        data = self._api_request(url)
        if isinstance(data, dict) and "tag_name" in data:
            return Release(
                tag=data["tag_name"],
                name=data.get("name") or data["tag_name"],
                published_at=data["published_at"],
                html_url=data["html_url"],
                body=data.get("body") or "",
            )

        return None

    def get_recent_commits(
        self,
        owner: str,
        repo: str,
        branch: str = "main",
        since: Optional[datetime] = None,
        limit: int = 10,
    ) -> list[Commit]:
        """
        Get recent commits for a repository.

        Args:
            owner: Repository owner
            repo: Repository name
            branch: Branch name (default: main)
            since: Only return commits after this date
            limit: Maximum number of commits to return
        """
        url = f"https://api.github.com/repos/{owner}/{repo}/commits?sha={branch}&per_page={limit}"

        if since:
            url += f"&since={since.isoformat()}"

        data = self._api_request(url)
        if isinstance(data, list):
            commits = []
            for item in data:
                try:
                    commits.append(
                        Commit(
                            sha=item["sha"][:7],  # Short SHA
                            message=item["commit"]["message"].split("\n")[0],  # First line only
                            author=item["commit"]["author"]["name"],
                            date=item["commit"]["author"]["date"],
                            html_url=item["html_url"],
                        )
                    )
                except (KeyError, TypeError) as e:
                    print(f"WARNING: Skipping malformed commit entry: {e}")
                    continue
            return commits

        return []

    def check_updates(
        self,
        owner: str,
        repo: str,
        branch: str = "main",
        track_releases: bool = True,
        track_commits: bool = True,
    ) -> RepoUpdate:
        """
        Check for new updates in a repository.

        Args:
            owner: Repository owner
            repo: Repository name
            branch: Branch to track for commits
            track_releases: Whether to check for new releases
            track_commits: Whether to check for new commits

        Returns:
            RepoUpdate with lists of new releases and commits
        """
        state = self._get_repo_state(owner, repo)
        new_releases = []
        new_commits = []

        # Check releases
        if track_releases:
            latest_release = self.get_latest_release(owner, repo)
            if latest_release:
                last_tag = state["last_release_tag"]
                if last_tag is None or latest_release.tag != last_tag:
                    new_releases.append(latest_release)
                    # Update state with new release
                    self._update_repo_state(owner, repo, last_release_tag=latest_release.tag)

        # Check commits (configurable days)
        if track_commits:
            since = datetime.now() - timedelta(days=self.days)
            recent_commits = self.get_recent_commits(owner, repo, branch, since=since, limit=10)

            if recent_commits:
                last_sha = state["last_commit_sha"]

                # If we have a last SHA, only include commits after it
                if last_sha:
                    for commit in recent_commits:
                        if commit.sha == last_sha:
                            break
                        new_commits.append(commit)
                else:
                    # First run - include all recent commits
                    new_commits = recent_commits

                # Update state with latest commit
                if recent_commits:
                    self._update_repo_state(owner, repo, last_commit_sha=recent_commits[0].sha)

        has_updates = len(new_releases) > 0 or len(new_commits) > 0

        return RepoUpdate(
            owner=owner,
            repo=repo,
            new_releases=new_releases,
            new_commits=new_commits,
            has_updates=has_updates,
        )
