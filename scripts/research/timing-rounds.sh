#!/usr/bin/env bash
# Core of timing-vitest.sh and timing-jest.sh (use those): suite timing
# rounds with jsdom and warpdom alternating.
#
#   CONFIGS="jsdom-default warpdom-default" scripts/research/timing-rounds.sh <csv> <rounds> <project...>
#
# Per round, per project, each configuration in CONFIGS in turn
# (<jsdom|happy-dom|warpdom|warpdomframes>-<default|vm>; vm adds --pool=vmThreads,
# Vitest only; warpdomframes is warpdom with WARPDOM_FAST_FRAMES=1, for a
# warpdom build that has the fast-frames experiment). Ablations of warpdom:
# warpdomeager (all interfaces created with the window), warpdomnocache (no
# query result cache), warpdomlatest (latest jsdom profile for every project).
# A/A controls: warpdom-default-aa (warpdom-default under a second name) and
# warpdom-ablate-unset (WARPDOM_ABLATE set to ''; every other configuration
# runs with it unset). jsdom-sharedclean (Vitest only): jsdom without
# isolation plus the generic cleanup of shared-cleanup.mjs before every
# test file. parse_config in configs.sh has the full list.
#
# TIMEOUT_MIN (default 45): per package run; a package that times out or
# fails to produce results makes that round's time NA.
#
# PERFILE_DIR (optional, Vitest only): also record per-file phase timings
# (perfile-reporter.mjs) as <dir>/<project>.<config>.<round>.jsonl.
# Protocol: one untimed warm-up run of every configuration per project
# (rows in <csv>.warmup.csv), then <rounds> rounds, the configuration order
# rotated by one position per round (rotate in lib.sh), so no
# configuration always runs first.
#
# Appends round,project,config,seconds,differs,files_differ to <csv>
# (created with a header if missing); seconds is the runner time the
# harness reports summed over the project's packages (the harness runs a
# monorepo's packages one by one: each package's own time goes to
# <csv without .csv>.packages.csv as round,project,config,package,status,
# seconds, round 0 the warm-up; timing-report.cjs --packages summarizes it);
# differs counts tests
# and files_differ test files whose status differs from the project's jsdom
# baseline (statuses.cjs, the key definition shared by all research
# scripts). Every run's per-test statuses go to
# $PERTEST_DIR/<round>/<project>/<config>.json (default <csv>.pertest;
# round 0 is the warm-up). The run's environment is written to
# <csv without .csv>.env-<timestamp>.json. Summarize with
# scripts/research/timing-report.cjs (medians).
#
# A project is built (corpus.json "build") before its first run only. With
# no jsdom baseline yet (a fresh machine, e.g. CI), the first jsdom run
# (the warm-up's) becomes the baseline the differences are counted against.
[ $# -ge 3 ] || { echo "usage: CONFIGS=... timing-rounds.sh <csv> <rounds> <project...>" >&2; exit 2; }
case $1 in /*) csv=$1;; *) csv=$PWD/$1;; esac; shift
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
rounds=$1; shift
CONFIGS=${CONFIGS:-"jsdom-default warpdom-default jsdom-vm warpdom-vm"}
mkdir -p "$(dirname "$csv")"
[ -f "$csv" ] || echo "round,project,config,seconds,differs,files_differ" > "$csv"
warmcsv=${csv%.csv}.warmup.csv
pkgcsv=${csv%.csv}.packages.csv
[ -f "$pkgcsv" ] || echo "round,project,config,package,status,seconds" > "$pkgcsv"
[ -f "$warmcsv" ] || echo "round,project,config,seconds,differs,files_differ" > "$warmcsv"
PT=${PERTEST_DIR:-${csv%.csv}.pertest}
mkdir -p "$PT" && PT=$(cd "$PT" && pwd)
record_env "${csv%.csv}.env-$(date +%Y%m%d-%H%M%S).json"
read -r -a configs <<< "$CONFIGS"
built=" "
notes=${csv%.csv}.notes.txt
# A configuration with no time in the warm-up (it timed out or failed) is
# not run again for that project: its timed rounds record NA (happy-dom on
# handsontable timed out every round and used up the 6-hour job limit).
dropped=" "
started=$(date +%s); longest=0
for round in $(seq 0 $rounds); do
  # BUDGET_MIN (optional): no round is started that cannot finish in time.
  now=$(date +%s)
  if [ -n "$BUDGET_MIN" ] && [ $round -gt 1 ] && [ $(( now - started + longest )) -gt $(( BUDGET_MIN * 60 )) ]; then
    echo "BUDGET: stopped before round $round of $rounds ($(( (now - started) / 60 )) min used, rounds take up to $(( longest / 60 )) min, budget $BUDGET_MIN min): $*" | tee -a "$notes" >&2
    break
  fi
  round_start=$now
  order=$CONFIGS; [ $round -gt 0 ] && order=$(rotate $round "${configs[@]}")
  out_csv=$csv; [ $round = 0 ] && out_csv=$warmcsv
  for project in "$@"; do
    base=$(baseline_dir $project)
    mkdir -p "$PT/$round/$project"
    for cfg in $order; do
      if [[ "$dropped" == *" $project:$cfg "* ]]; then
        echo "$round,$project,$cfg,NA,NA,NA" >> "$out_csv"
        echo "TIMING round $round $project $cfg: skipped (no time in the warm-up)"
        continue
      fi
      build=""
      case "$built" in *" $project "*) build="--no-build";; *) built="$built$project ";; esac
      # parse_config (configs.sh): environment, WARPDOM_ABLATE, fast frames, pool.
      parsed=$(parse_config "$cfg") || { echo "unknown configuration $cfg" >&2; exit 2; }
      read -r env ablate frames pool shared <<< "$parsed"
      [ "$frames" = - ] && frames=""
      extra=""; [ "$pool" = - ] || extra="--pool=$pool"
      setup=()
      if [ "$shared" = clean ]; then extra="$extra --no-isolate"; setup=(--project-setup "$RESEARCH_DIR/shared-cleanup.mjs"); fi
      out=$ENV_DIR/timing-$cfg
      rm -rf $out
      perfile=""
      if [ -n "$PERFILE_DIR" ] && [ $round -gt 0 ]; then
        mkdir -p "$PERFILE_DIR"
        perfile="$(cd "$PERFILE_DIR" && pwd)/$project.$cfg.$round.jsonl"
        extra="$extra --reporter=$RESEARCH_DIR/perfile-reporter.mjs"
      fi
      # WARPDOM_ABLATE: unset unless the configuration sets it (with_ablate).
      log=$(PERFILE_OUT=$perfile WARPDOM_FAST_FRAMES=$frames with_ablate "$ablate" harness --only $project --environment $env --out $out --max-workers 2 --timeout ${TIMEOUT_MIN:-45} $build ${extra:+--extra-args "$extra"} "${setup[@]}" 2>&1)
      if [ "$env" = jsdom ] && ! ls "$base"/*.jsdom.json >/dev/null 2>&1; then
        base=$ENV_DIR/jsdom-time/tmp/$project
        mkdir -p "$base" && cp "$out/tmp/$project"/*.jsdom.json "$base"/ 2>/dev/null
      fi
      # A package that failed to run (timeout, no results) makes the round
      # incomplete: its time would cover only the other packages (NA).
      secs=$(echo "$log" | complete_seconds)
      # Each package's own runner time (the harness runs packages one by one).
      echo "$log" | package_times | while read -r pkg pstatus psecs; do
        echo "$round,$project,$cfg,$pkg,$pstatus,$psecs" >> "$pkgcsv"
      done
      # No time: the harness failed; show why.
      [ -n "$secs" ] || { echo "harness output for $project $cfg (round $round):"; echo "$log" | tail -40; } >&2
      status_map $out/tmp/$project $env "$PT/$round/$project/$cfg.json" $project
      status_map $base jsdom "$PT/$round/$project/.baseline.json" $project
      read -r differs files_differ <<< "$(statuses compare "$PT/$round/$project/.baseline.json" "$PT/$round/$project/$cfg.json")"
      echo "$round,$project,$cfg,${secs:-NA},$differs,$files_differ" >> "$out_csv"
      echo "TIMING round $round $project $cfg: ${secs:-NA}s, $differs tests / $files_differ files differ"
      if [ $round = 0 ] && [ -z "$secs" ]; then
        dropped="$dropped$project:$cfg "
        echo "warm-up: $project $cfg has no time; not run in the timed rounds" | tee -a "$notes" >&2
      fi
    done
    rm -f "$PT/$round/$project/.baseline.json"
  done
  [ $round -gt 0 ] && [ $(( $(date +%s) - round_start )) -gt $longest ] && longest=$(( $(date +%s) - round_start ))
done
echo "TIMING done"
