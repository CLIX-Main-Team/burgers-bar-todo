#!/usr/bin/env bash
#
# wip.sh — cross-session ticket claiming.
#
# Several Claude Code / dev sessions run against this repo at once, all as the
# same GitHub account. Nothing on GitHub distinguishes "a session of mine is
# already on this ticket" from "free to pick up", which is how two sessions end
# up on the same issue. This wraps the claim protocol from
# docs/agents/issue-tracker.md so a claim is:
#
#   - atomic     — an flock guards the check-then-claim, so two sessions racing
#                  for the same ticket can't both win.
#   - visible    — the issue is assigned to you and gets the `in-progress`
#                  label, so it shows in the GitHub UI and drops out of the
#                  frontier query for every other session.
#   - attributed — a local ledger (in the shared .git common dir, so every
#                  worktree sees it) records which branch/worktree drives each
#                  claim. Assignee can't tell you that — every session is you.
#   - releasable — `release` clears the claim when you abandon a ticket, so it
#                  doesn't sit `in-progress` forever (a merged PR closing the
#                  issue also clears it — closed issues leave the frontier).
#
# Usage:
#   scripts/wip.sh board            # what every session is working on, + worktrees
#   scripts/wip.sh claim <issue>    # claim a ticket (refuses if already held)
#   scripts/wip.sh release <issue>  # give a ticket back
#   scripts/wip.sh whoami <issue>   # show the claim state of one ticket
#
# Requires: gh (authenticated), git, flock. Run from anywhere inside the repo.

set -euo pipefail

INPROGRESS_LABEL="in-progress"
READY_LABEL="ready-for-agent"

die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[36m→ %s\033[0m\n' "$*" >&2; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*" >&2; }

command -v gh   >/dev/null 2>&1 || die "gh CLI not found"
command -v git  >/dev/null 2>&1 || die "git not found"
git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repo"

# The .git common dir is shared by every worktree, so state placed here is seen
# by all sessions and is never part of any checkout.
COMMON_DIR="$(git rev-parse --git-common-dir)"
case "$COMMON_DIR" in /*) ;; *) COMMON_DIR="$(git rev-parse --show-toplevel)/$COMMON_DIR" ;; esac
LEDGER="$COMMON_DIR/ticket-claims.tsv"      # issue \t branch \t worktree \t iso-time
LOCKFILE="$COMMON_DIR/ticket-claims.lock"
touch "$LEDGER" "$LOCKFILE"

ME="$(gh api user --jq .login 2>/dev/null)" || die "gh not authenticated (run: gh auth login)"

cur_branch()   { git rev-parse --abbrev-ref HEAD; }
cur_worktree() { git rev-parse --show-toplevel; }

# Create the in-progress label once, on demand. Harmless if it already exists.
ensure_label() {
  gh label list --limit 200 --json name --jq '.[].name' 2>/dev/null | grep -qx "$INPROGRESS_LABEL" \
    || gh label create "$INPROGRESS_LABEL" --color FBCA04 --description "A session is actively working this" >/dev/null 2>&1 \
    || true
}

ledger_branch_for() { awk -F'\t' -v n="$1" '$1==n {print $2; exit}' "$LEDGER"; }
ledger_remove()     { local n="$1"; grep -v -P "^${n}\t" "$LEDGER" > "$LEDGER.tmp" 2>/dev/null || true; mv "$LEDGER.tmp" "$LEDGER"; }
ledger_upsert() {
  local n="$1" branch="$2" wt="$3" ts; ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ledger_remove "$n"
  printf '%s\t%s\t%s\t%s\n' "$n" "$branch" "$wt" "$ts" >> "$LEDGER"
}

# ── claim ────────────────────────────────────────────────────────────────────
cmd_claim() {
  local n="${1:-}"; [ -n "$n" ] || die "usage: wip.sh claim <issue>"
  ensure_label
  local branch wt; branch="$(cur_branch)"; wt="$(cur_worktree)"

  # Critical section: check-then-claim under a lock so no two sessions both win.
  exec 9>"$LOCKFILE"; flock 9

  local state assignees
  state="$(gh issue view "$n" --json state --jq .state 2>/dev/null)" || die "cannot read issue #$n"
  [ "$state" = "OPEN" ] || die "#$n is $state, not open"
  assignees="$(gh issue view "$n" --json assignees --jq '[.assignees[].login]|join(",")')"

  if [ -n "$assignees" ]; then
    local held; held="$(ledger_branch_for "$n")"
    if [ "$held" = "$branch" ]; then
      ok "#$n is already yours (this branch). Nothing to do."; return 0
    fi
    if [ -n "$held" ]; then
      die "#$n is already claimed by another of your sessions on branch '$held'. Pick a different ticket, or 'release' it there first."
    fi
    die "#$n is assigned to '$assignees' (no local ledger entry — claimed outside this tool). Not taking it."
  fi

  gh issue edit "$n" --add-assignee @me >/dev/null
  gh issue edit "$n" --add-label "$INPROGRESS_LABEL" --remove-label "$READY_LABEL" >/dev/null 2>&1 || \
    gh issue edit "$n" --add-label "$INPROGRESS_LABEL" >/dev/null 2>&1 || true
  ledger_upsert "$n" "$branch" "$wt"
  flock -u 9

  ok "Claimed #$n on branch '$branch'."
  gh issue view "$n" --json number,title --jq '"  #\(.number) \(.title)"' >&2 || true
}

# ── release ──────────────────────────────────────────────────────────────────
cmd_release() {
  local n="${1:-}"; [ -n "$n" ] || die "usage: wip.sh release <issue>"
  exec 9>"$LOCKFILE"; flock 9
  gh issue edit "$n" --remove-assignee @me >/dev/null 2>&1 || true
  gh issue edit "$n" --remove-label "$INPROGRESS_LABEL" >/dev/null 2>&1 || true
  ledger_remove "$n"
  flock -u 9
  ok "Released #$n. (Re-add '$READY_LABEL' if it should go back on the frontier.)"
}

# ── whoami ───────────────────────────────────────────────────────────────────
cmd_whoami() {
  local n="${1:-}"; [ -n "$n" ] || die "usage: wip.sh whoami <issue>"
  local branch; branch="$(ledger_branch_for "$n")"
  gh issue view "$n" --json number,state,title,assignees,labels \
    --jq '"#\(.number) [\(.state)] \(.title)\n  assignee: \([.assignees[].login]|join(",") // "none")\n  labels:   \([.labels[].name]|join(", "))"' >&2
  [ -n "$branch" ] && printf '  branch:   %s\n' "$branch" >&2 || printf '  branch:   (no local claim ledgered)\n' >&2
}

# ── board ────────────────────────────────────────────────────────────────────
cmd_board() {
  printf '\n\033[1mClaimed / in-progress tickets\033[0m\n' >&2
  local rows
  rows="$(gh issue list --state open --assignee "$ME" \
            --json number,title,labels \
            --jq '.[] | "\(.number)\t\(.title)\t\([.labels[].name]|join(","))"' 2>/dev/null || true)"
  # Also surface anything wearing the in-progress label even if unassigned.
  rows="$rows"$'\n'"$(gh issue list --state open --label "$INPROGRESS_LABEL" \
            --json number,title,labels \
            --jq '.[] | "\(.number)\t\(.title)\t\([.labels[].name]|join(","))"' 2>/dev/null || true)"

  local seen=""
  if [ -z "$(printf '%s' "$rows" | tr -d '[:space:]')" ]; then
    printf '  (none)\n' >&2
  else
    printf '%s\n' "$rows" | sort -n | while IFS=$'\t' read -r num title labels; do
      [ -n "$num" ] || continue
      case " $seen " in *" $num "*) continue ;; esac
      seen="$seen $num"
      local branch; branch="$(ledger_branch_for "$num")"
      printf '  \033[33m#%s\033[0m  %s\n' "$num" "$title" >&2
      printf '       branch: %s   labels: %s\n' "${branch:-—}" "${labels:-—}" >&2
    done
  fi

  printf '\n\033[1mActive worktrees\033[0m\n' >&2
  git worktree list | sed 's/^/  /' >&2
  printf '\n' >&2
}

case "${1:-board}" in
  claim)          shift; cmd_claim   "$@" ;;
  release|unclaim) shift; cmd_release "$@" ;;
  whoami|status)  shift; cmd_whoami  "$@" ;;
  board|"")       cmd_board ;;
  *) die "unknown command '$1' (want: board | claim | release | whoami)" ;;
esac
