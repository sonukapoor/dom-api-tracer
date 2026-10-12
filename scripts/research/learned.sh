#!/usr/bin/env bash
# Learning fast mode (Vitest): warpdom's `warpdom vitest run` against jsdom
# and warpdom's isolated runs (docs/fast-mode.md and the "learned" table in
# docs/head-to-head.md in warpdom).
#
#   scripts/research/learned.sh <csv> <rounds> <project...>
#
# ablation-isolation.sh with CONFIGS="jsdom-default warpdom-default
# warpdom-learned" (override with CONFIGS): the same protocol (warm-up,
# counterbalanced order, re-learning every round, NA for failed runs), the
# same counting (statuses.cjs) and the same learned runs (the shipped CLI
# where it runs, else its emulation); see that script for the output.
# Summarize with ablation-report.cjs.
CONFIGS=${CONFIGS:-"jsdom-default warpdom-default warpdom-learned"} exec "$(dirname "${BASH_SOURCE[0]}")/ablation-isolation.sh" "$@"
