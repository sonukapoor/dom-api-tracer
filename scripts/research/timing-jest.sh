#!/usr/bin/env bash
# Jest suite timings: jsdom (jest-environment-jsdom) and warpdom
# (warpdom/jest) alternating, 2 workers. Jest has no VM pool option.
#
#   scripts/research/timing-jest.sh <csv> <rounds> <project...>
#   e.g. scripts/research/timing-jest.sh .corpus-env/timing-jest-2026-10-11.csv 3 react-spectrum handsontable
#
# Appends round,project,config,seconds,differs rows to <csv> and records the
# environment next to it (see timing-rounds.sh). Medians:
# node scripts/research/timing-report.cjs <csv>
CONFIGS="jsdom-default warpdom-default" exec "$(dirname "${BASH_SOURCE[0]}")/timing-rounds.sh" "$@"
