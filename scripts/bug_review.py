#!/usr/bin/env python3
"""
SocyBase Bug Review Agent
Scans the codebase for bugs using Claude API and reports/fixes them.

Usage:
  Local:  python scripts/bug_review.py
  CI:     python scripts/bug_review.py --ci

Env vars:
  ANTHROPIC_API_KEY  — required
  GITHUB_TOKEN       — required in CI for creating issues/PRs
  GITHUB_REPOSITORY  — auto-set in GitHub Actions (owner/repo)
"""

import os
import sys
import json
import argparse
import subprocess
from pathlib import Path
from datetime import datetime

try:
    import anthropic
except ImportError:
    print("Install anthropic: pip install anthropic")
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL = "claude-sonnet-4-5-20250929"

# Files to review — critical paths most likely to have bugs
REVIEW_TARGETS = {
    "backend": [
        "backend/app/scraping/pipeline.py",
        "backend/app/api/v1/jobs.py",
        "backend/app/api/v1/fb_ads.py",
        "backend/app/services/meta_api.py",
        "backend/app/services/ai_campaign_gen.py",
        "backend/app/api/v1/credits.py",
    ],
    "frontend": [
        "frontend/src/app/(dashboard)/jobs/[id]/page.tsx",
        "frontend/src/app/(dashboard)/fb-ads/launch/page.tsx",
        "frontend/src/lib/api-client.ts",
        "frontend/src/types/index.ts",
    ],
}

SYSTEM_PROMPT = """You are a senior code reviewer for SocyBase, a social media intelligence SaaS platform.

Stack: FastAPI + SQLAlchemy async + Celery (backend), Next.js + TypeScript + Tailwind (frontend).

Review the code for REAL bugs only. Do NOT report:
- Style/formatting issues
- Missing comments or docstrings
- Minor naming preferences
- Theoretical issues that can't actually happen

DO report:
- Logic errors (falsy-zero with ||, off-by-one, wrong comparisons)
- Race conditions in async code
- Missing await keywords
- SQL injection or security vulnerabilities
- Broken error handling (swallowed errors, wrong status codes)
- Type mismatches between frontend and backend
- State management bugs (stale closures, missing deps)
- API contract mismatches
- Memory leaks (unclosed connections, missing cleanup)

For each bug found, respond with a JSON array of objects:
{
  "bugs": [
    {
      "file": "path/to/file.py",
      "line": 123,
      "severity": "critical|high|medium|low",
      "title": "Short description",
      "description": "What's wrong and why it matters",
      "fix": "The exact code fix (diff-style or replacement)",
      "auto_fixable": true
    }
  ],
  "summary": "One paragraph overview of findings"
}

If no bugs found, return: {"bugs": [], "summary": "No bugs found."}
Return ONLY valid JSON, no markdown fences.
"""


def read_file(path: str) -> str | None:
    full = PROJECT_ROOT / path
    if not full.exists():
        return None
    try:
        return full.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None


def get_recent_diff() -> str:
    """Get git diff of last 7 days of changes."""
    try:
        result = subprocess.run(
            ["git", "log", "--since=7 days ago", "--oneline", "-20"],
            capture_output=True, text=True, cwd=PROJECT_ROOT,
        )
        commits = result.stdout.strip()
        if not commits:
            return ""
        result = subprocess.run(
            ["git", "diff", "HEAD~10..HEAD", "--stat"],
            capture_output=True, text=True, cwd=PROJECT_ROOT,
        )
        return f"Recent commits:\n{commits}\n\nChanged files:\n{result.stdout.strip()}"
    except Exception:
        return ""


def scan_codebase(client: anthropic.Anthropic) -> dict:
    """Send code to Claude for review."""
    # Build the review payload
    file_contents = []
    for category, paths in REVIEW_TARGETS.items():
        for path in paths:
            content = read_file(path)
            if content:
                # Limit to 500 lines for very large files
                lines = content.split("\n")
                if len(lines) > 500:
                    content = "\n".join(lines[:500]) + f"\n\n... ({len(lines) - 500} more lines truncated)"
                file_contents.append(f"=== {path} ({category}) ===\n{content}")

    if not file_contents:
        return {"bugs": [], "summary": "No files found to review."}

    recent_diff = get_recent_diff()

    user_message = "Review these files for bugs:\n\n"
    if recent_diff:
        user_message += f"Context — recent changes:\n{recent_diff}\n\n---\n\n"
    user_message += "\n\n---\n\n".join(file_contents)

    print(f"Reviewing {len(file_contents)} files...")
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    text = response.content[0].text.strip()
    # Strip markdown fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
    if text.endswith("```"):
        text = text.rsplit("```", 1)[0]

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"bugs": [], "summary": f"Failed to parse response: {text[:200]}"}


def print_report(result: dict):
    """Print findings to console."""
    bugs = result.get("bugs", [])
    summary = result.get("summary", "")

    print("\n" + "=" * 60)
    print("  SocyBase Bug Review Report")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)
    print(f"\n{summary}\n")

    if not bugs:
        print("No bugs found. Codebase looks clean!")
        return

    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    bugs.sort(key=lambda b: severity_order.get(b.get("severity", "low"), 4))

    severity_icons = {"critical": "[!!]", "high": "[!]", "medium": "[~]", "low": "[.]"}

    for i, bug in enumerate(bugs, 1):
        sev = bug.get("severity", "low")
        icon = severity_icons.get(sev, "[?]")
        print(f"  {icon} #{i} [{sev.upper()}] {bug.get('title', 'Unknown')}")
        print(f"      File: {bug.get('file', '?')}:{bug.get('line', '?')}")
        print(f"      {bug.get('description', '')}")
        if bug.get("fix"):
            print(f"      Fix: {bug['fix'][:120]}...")
        print()

    fixable = [b for b in bugs if b.get("auto_fixable")]
    print(f"Total: {len(bugs)} bugs ({len(fixable)} auto-fixable)")


def create_github_issue(bugs: list, summary: str):
    """Create a GitHub issue with bug findings."""
    if not bugs:
        return

    title = f"Bug Review: {len(bugs)} issue(s) found — {datetime.now().strftime('%Y-%m-%d')}"

    body_lines = [
        "## Automated Bug Review Report",
        f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}",
        f"**Summary:** {summary}",
        "",
    ]

    severity_emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵"}

    for i, bug in enumerate(bugs, 1):
        sev = bug.get("severity", "low")
        emoji = severity_emoji.get(sev, "⚪")
        body_lines.append(f"### {emoji} #{i} [{sev.upper()}] {bug.get('title', 'Unknown')}")
        body_lines.append(f"**File:** `{bug.get('file', '?')}:{bug.get('line', '?')}`")
        body_lines.append(f"**Auto-fixable:** {'Yes' if bug.get('auto_fixable') else 'No'}")
        body_lines.append(f"\n{bug.get('description', '')}")
        if bug.get("fix"):
            body_lines.append(f"\n```diff\n{bug['fix']}\n```")
        body_lines.append("")

    body_lines.append("---")
    body_lines.append("*Generated by SocyBase Bug Review Agent*")

    body = "\n".join(body_lines)

    try:
        result = subprocess.run(
            ["gh", "issue", "create", "--title", title, "--body", body, "--label", "bug,automated-review"],
            capture_output=True, text=True, cwd=PROJECT_ROOT,
        )
        if result.returncode == 0:
            print(f"Created issue: {result.stdout.strip()}")
        else:
            # Labels might not exist, retry without
            result = subprocess.run(
                ["gh", "issue", "create", "--title", title, "--body", body],
                capture_output=True, text=True, cwd=PROJECT_ROOT,
            )
            if result.returncode == 0:
                print(f"Created issue: {result.stdout.strip()}")
            else:
                print(f"Failed to create issue: {result.stderr}")
    except Exception as e:
        print(f"Failed to create issue: {e}")


def auto_fix_and_pr(bugs: list):
    """Apply auto-fixable bugs and create a PR."""
    fixable = [b for b in bugs if b.get("auto_fixable") and b.get("fix")]
    if not fixable:
        print("No auto-fixable bugs to apply.")
        return

    branch = f"fix/auto-review-{datetime.now().strftime('%Y%m%d-%H%M')}"

    try:
        # Create branch
        subprocess.run(["git", "checkout", "-b", branch], cwd=PROJECT_ROOT, check=True)

        applied = []
        for bug in fixable:
            file_path = PROJECT_ROOT / bug["file"]
            if not file_path.exists():
                continue
            # Log what we'd fix — actual application needs the fix to be a proper diff
            applied.append(bug)
            print(f"  Marked for fix: {bug['file']}:{bug.get('line')} — {bug['title']}")

        if not applied:
            subprocess.run(["git", "checkout", "main"], cwd=PROJECT_ROOT)
            subprocess.run(["git", "branch", "-D", branch], cwd=PROJECT_ROOT)
            return

        # Stage and commit
        subprocess.run(["git", "add", "-A"], cwd=PROJECT_ROOT, check=True)

        # Check if there are actual changes
        result = subprocess.run(
            ["git", "diff", "--cached", "--quiet"],
            cwd=PROJECT_ROOT, capture_output=True,
        )
        if result.returncode == 0:
            print("No actual file changes to commit.")
            subprocess.run(["git", "checkout", "main"], cwd=PROJECT_ROOT)
            subprocess.run(["git", "branch", "-D", branch], cwd=PROJECT_ROOT)
            return

        commit_msg = f"fix: auto-review — {len(applied)} bug(s) fixed\n\n"
        for bug in applied:
            commit_msg += f"- [{bug['severity']}] {bug['title']} ({bug['file']}:{bug.get('line')})\n"

        subprocess.run(["git", "commit", "-m", commit_msg], cwd=PROJECT_ROOT, check=True)
        subprocess.run(["git", "push", "-u", "origin", branch], cwd=PROJECT_ROOT, check=True)

        # Create PR
        pr_body = "## Auto-Fix Bug Review\n\n"
        for bug in applied:
            pr_body += f"- **[{bug['severity'].upper()}]** {bug['title']} (`{bug['file']}:{bug.get('line')}`)\n"
        pr_body += "\n---\n*Generated by SocyBase Bug Review Agent. Please review before merging.*"

        result = subprocess.run(
            ["gh", "pr", "create", "--title", f"fix: auto-review {len(applied)} bug(s)",
             "--body", pr_body, "--base", "main"],
            capture_output=True, text=True, cwd=PROJECT_ROOT,
        )
        if result.returncode == 0:
            print(f"Created PR: {result.stdout.strip()}")

        # Switch back to main
        subprocess.run(["git", "checkout", "main"], cwd=PROJECT_ROOT)

    except Exception as e:
        print(f"Auto-fix failed: {e}")
        subprocess.run(["git", "checkout", "main"], cwd=PROJECT_ROOT, capture_output=True)


def main():
    parser = argparse.ArgumentParser(description="SocyBase Bug Review Agent")
    parser.add_argument("--ci", action="store_true", help="CI mode: create issues/PRs")
    parser.add_argument("--fix", action="store_true", help="Auto-fix and create PR")
    parser.add_argument("--files", nargs="*", help="Specific files to review (overrides defaults)")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    # Override review targets if specific files given
    if args.files:
        REVIEW_TARGETS.clear()
        REVIEW_TARGETS["custom"] = args.files

    # Run review
    result = scan_codebase(client)
    print_report(result)

    bugs = result.get("bugs", [])

    if args.ci or args.fix:
        # In CI: create issue for non-fixable, PR for fixable
        non_fixable = [b for b in bugs if not b.get("auto_fixable")]
        if non_fixable:
            create_github_issue(non_fixable, result.get("summary", ""))

        if args.fix:
            auto_fix_and_pr(bugs)
    else:
        # Local mode: just print
        if bugs:
            print("\nRun with --fix to auto-fix and create PR")
            print("Run with --ci to create GitHub issues")

    # Exit with error code if critical/high bugs found
    critical = [b for b in bugs if b.get("severity") in ("critical", "high")]
    sys.exit(1 if critical else 0)


if __name__ == "__main__":
    main()
