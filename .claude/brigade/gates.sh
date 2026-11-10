#!/usr/bin/env bash
# The project's gates. The exit code IS the verdict: 0 = green.
# Usage: gates.sh [<worktree>]   (default: the root of the current repository)
set -euo pipefail
WT="${1:-$(git rev-parse --show-toplevel)}"
cd "$WT"
cd web && pnpm exec tsc --noEmit && pnpm lint && pnpm test
