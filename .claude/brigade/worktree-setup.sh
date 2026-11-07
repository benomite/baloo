#!/usr/bin/env bash
# Makes a worktree runnable. On stdout, only `export` lines: the caller evaluates them.
# Usage: worktree-setup.sh <n> <worktree>
set -euo pipefail
N="$1"; WT="$2"
(cd "$WT" && cd web && pnpm install --frozen-lockfile) >&2
