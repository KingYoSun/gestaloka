#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--dry-run]" >&2
  exit 2
fi

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf 'dry-run:'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

collect_pids() {
  local pattern='(@playwright/mcp|playwright-mcp|mcp-server-playwright|mcp-chrome-)'
  pgrep -u "$(id -u)" -f "$pattern" 2>/dev/null | while read -r pid; do
    if [[ -n "$pid" && "$pid" != "$$" && "$pid" != "${PPID:-}" ]]; then
      printf '%s\n' "$pid"
    fi
  done
}

mapfile -t pids < <(collect_pids)
if [[ "${#pids[@]}" -gt 0 ]]; then
  echo "Found Playwright MCP process(es): ${pids[*]}"
  run kill -TERM "${pids[@]}"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    sleep 2
    mapfile -t remaining < <(collect_pids)
    if [[ "${#remaining[@]}" -gt 0 ]]; then
      echo "Force-stopping Playwright MCP process(es): ${remaining[*]}"
      run kill -KILL "${remaining[@]}"
    fi
  fi
else
  echo "No Playwright MCP processes found."
fi

cache_root="${PLAYWRIGHT_MCP_CACHE_DIR:-$HOME/.cache/ms-playwright}"
if [[ ! -d "$cache_root" ]]; then
  echo "Playwright cache directory not found: $cache_root"
  exit 0
fi

mapfile -t lock_files < <(
  find "$cache_root" \
    -path "$cache_root/mcp-chrome-*/*" \
    \( -name 'SingletonLock' -o -name 'SingletonCookie' -o -name 'SingletonSocket' \) \
    -print 2>/dev/null
)

if [[ "${#lock_files[@]}" -gt 0 ]]; then
  echo "Removing Playwright MCP Chrome lock file(s):"
  printf '  %s\n' "${lock_files[@]}"
  run rm -f "${lock_files[@]}"
else
  echo "No Playwright MCP Chrome lock files found."
fi
