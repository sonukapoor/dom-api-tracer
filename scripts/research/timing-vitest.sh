#!/usr/bin/env bash
# Vitest suite timings: jsdom and warpdom alternating, each in Vitest's
# default pool and with --pool=vmThreads, 2 workers.
#
#   scripts/research/timing-vitest.sh <csv> <rounds> <project...>
#   e.g. scripts/research/timing-vitest.sh .corpus-env/timing-2026-10-11.csv 3 material-ui
#
# Appends round,project,config,seconds,differs rows to <csv> and records the
# environment next to it (see timing-rounds.sh). Medians:
# node scripts/research/timing-report.cjs <csv>
CONFIGS="jsdom-default warpdom-default jsdom-vm warpdom-vm" exec "$(dirname "${BASH_SOURCE[0]}")/timing-rounds.sh" "$@"
