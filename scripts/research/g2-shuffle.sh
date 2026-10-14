#!/usr/bin/env bash
# Assumption G2 of learned isolation (warpdom's fast mode) under shuffled
# file orders: state left behind by test files that share a worker can make
# a test fail, never make a test pass that fails isolated. The ablation
# (ablation-isolation.sh) checks G2 only in Vitest's own file order; here
# the files sharing workers run in K shuffled orders (Vitest's
# --sequence.shuffle.files --sequence.seed=<s>, Vitest >= 1; every suite
# of the experiment is on Vitest 4 or 5).
#
#   [SEEDS="1 2 ..."] [ISO_RUNS=3] [CONFIRM_RUNS=3] [LEARNED=1] \
#     scripts/research/g2-shuffle.sh <out dir> <project...>
#
# Per project, in this order (the order of every run is in runs.csv):
#   iso-1                 warpdom isolated (warpdom-default), a reference
#                         (the first run also builds the project)
#   learning              `warpdom vitest run --learn` (LEARNED=1), in
#                         Vitest's own order: the state the learned runs use
#   for each seed s:
#     shared-s<s>         warpdom without isolation, warpdom's in-place reset
#                         (warpdom-sharedreset), files shuffled with seed s
#     learned-s<s>        warpdom's fast mode on a fresh copy of the learned
#                         state (every seed starts from the same state), files
#                         shuffled with seed s: the shared part shuffled
#   iso-2 ... iso-<ISO_RUNS>  more references, spread over the seeds (after
#                         every ceil(K / (ISO_RUNS - 1)) seeds, the last at the end)
#   confirm-1 ... confirm-<CONFIRM_RUNS>  the candidates' test files (see
#                         below) run isolated again, to tell a nondeterministic
#                         test from one that passes only after other files
#
# A candidate G2 violation is a test that passes in a shuffled shared (or
# learned) run and fails, is skipped or is missing in every iso-* run
# (g2-report.cjs candidates). g2-report.cjs classifies the candidates with
# the confirm-* runs and prints the per-worker file order of every
# candidate (order-setup.mjs records it in every run).
#
# Learned runs use the shipped `warpdom vitest run` (trace-corpus.mjs
# --fast-cli; Vitest >= 3.2, one --project argument; the shuffle arguments
# go to every Vitest run it starts) or, where it cannot run (or FAST_CLI=0),
# learned-emulation.sh with the shuffle only in the shared part
# (LEARN_SHARED_ARGS).
#
# Output, <out dir>/<project>/:
#   <label>.json          per-test statuses (statuses.cjs map form)
#   <label>.order.jsonl   order-setup.mjs rows of the run
#   <label>.fastcli.json  learned runs: the CLI's runs and states
#   learn.json, state/    the learning's map and state
#   runs.csv              label,kind,seed,seconds,status
#   learning.jsonl        learning and learned-run records (learning.cjs)
#   notes.txt             failed runs, budget stops
#   env-*.json            the environment (record-env.mjs)
#
# TIMEOUT_MIN (default 45) per harness run. BUDGET_MIN (optional): no seed is
# started that would not leave time for it and the remaining references
# (estimated from the longest seed and reference run so far); the stop is
# noted. See lib.sh for the rest.
[ $# -ge 2 ] || { echo "usage: [SEEDS=...] [ISO_RUNS=3] [CONFIRM_RUNS=3] [LEARNED=1] g2-shuffle.sh <out dir> <project...>" >&2; exit 2; }
case $1 in /*) OUT=$1;; *) OUT=$PWD/$1;; esac; shift
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
S=$WORK_DIR
W=$WARPDOM_DIR
E=$ENV_DIR
SEEDS=${SEEDS:-$(seq -s ' ' 1 10)}
ISO_RUNS=${ISO_RUNS:-3}
CONFIRM_RUNS=${CONFIRM_RUNS:-3}
LEARNED=${LEARNED:-1}
[ "$ISO_RUNS" -ge 1 ] || { echo "ISO_RUNS must be at least 1" >&2; exit 2; }
read -r -a seeds <<< "$SEEDS"
mkdir -p "$OUT"
ORDER=$RESEARCH_DIR/order-setup.mjs
# Shared runs: warpdom's reset first, then the order recorder.
first="--first-setup $W/src/vitest-reset.js --first-setup $ORDER"
shuffle() { echo "--sequence.shuffle.files --sequence.seed=$1"; }
rm -f $S/g2-built-*

# run <out> <harness args...>: one harness run of project $p into $E/<out>
# (learned-emulation.sh's calling convention), its file order appended to
# $D/<ORDER_LABEL or out>.order.jsonl; prints its seconds, or nothing if it
# failed. The output is kept in $S/g2-run.log and appended to $S/g2.log.
run() {
  local out=$1; shift
  local build="--no-build"; [ -f $S/g2-built-$p ] || build=""
  rm -rf "$E/$out"
  FILE_ORDER_OUT=$D/${ORDER_LABEL:-$out}.order.jsonl harness --max-workers 2 --timeout ${TIMEOUT_MIN:-45} $build --only $p --out "$E/$out" "$@" > "$S/g2-run.log" 2>&1
  touch $S/g2-built-$p
  cat "$S/g2-run.log" >> "$S/g2.log"
  complete_seconds < "$S/g2-run.log"
}
# labelled <label> <harness args...>: run into $E/g2-run, the order in $D/<label>.order.jsonl.
labelled() { local l=$1; shift; rm -f "$D/$l.order.jsonl"; ORDER_LABEL=$l run g2-run "$@"; }
na() {
  { echo "NA $p $*: $(grep -E '^\s+failed|fast-cli' "$S/g2-run.log" | tr -s ' ' | paste -sd'|' -)"
    tail -25 "$S/g2-run.log" | sed 's/^/    /'; } | tee -a "$notes" >&2
}
# done_run <label> <kind> <seed> <seconds>: the run's status map and row.
done_run() {
  status_map $E/g2-run/tmp/$p warpdom $D/$1.json $p
  local f; rm -rf $D/$1.fastcli
  for f in $E/g2-run/tmp/$p/*.fastcli.json; do [ -f "$f" ] && mkdir -p $D/$1.fastcli && cp "$f" $D/$1.fastcli/; done
  [ -n "$4" ] || na "$1"
  echo "$1,$2,$3,${4:-NA},$([ -n "$4" ] && echo ok || echo failed)" >> $D/runs.csv
  echo "G2 $p $1: ${4:-NA}s, $(statuses count $D/$1.json | awk '{print $1 " tests, " $2 " files"}')"
}
# The helpers learned-emulation.sh expects (the emulation only).
add() { local x; [ -n "$1" ] && [ -n "$2" ] && x=$(echo "$1 + $2" | bc) && echo "$x"; }
excludes() { for f in "$@"; do printf -- "--exclude %s " "$f"; done; }
count() { echo $# ; }

iso() { local t; t=$(labelled iso-$1 --environment warpdom --first-setup $ORDER); done_run iso-$1 iso "" "$t"; isos=$1; }
shared() { local t; t=$(labelled shared-s$1 --environment warpdom --extra-args "--no-isolate $(shuffle $1)" $first); done_run shared-s$1 shared $1 "$t"; }
learning() {
  method=harness
  if [ "${FAST_CLI:-1}" != 0 ]; then
    rm -rf $D/state; mkdir -p $D/state
    # The CLI adds warpdom's reset to the shared runs itself.
    local t; t=$(labelled learn --environment warpdom --fast-cli learn --fast-state $D/state --first-setup $ORDER)
    if [ -n "$t" ]; then
      method=cli
      nodex "$RESEARCH_DIR/learning.cjs" cli $E/g2-run/tmp/$p "$jsonl" 0 $p learn
    else
      echo "METHOD $p: harness emulation ($(grep -hoE 'fast-cli[^,]*|failed .*' $S/g2-run.log | head -3 | paste -sd'|' -))" | tee -a "$notes"
    fi
    done_run learn learning "" "$t"
  fi
  if [ $method = harness ]; then
    # Emulation (learned-emulation.sh): learning in Vitest's own order.
    rm -f $D/learn.order.jsonl
    ORDER_LABEL=learn learn_harness 0 $S/g2-state-$p $D/learn
    echo "learn,learning,,NA,harness" >> $D/runs.csv
  fi
  echo $method > $D/method
}
learned() {
  local s=$1 t
  if [ "$method" = cli ]; then
    rm -rf $S/g2-seed-state; cp -R $D/state $S/g2-seed-state
    t=$(labelled learned-s$s --environment warpdom --fast-cli run --fast-state $S/g2-seed-state --extra-args "$(shuffle $s)" --first-setup $ORDER)
    nodex "$RESEARCH_DIR/learning.cjs" cli $E/g2-run/tmp/$p "$jsonl" $s $p run
    done_run learned-s$s learned $s "$t"
  else
    # A fresh copy of the learned state per seed; only the shared part shuffled.
    for f in $S/g2-state-$p.*; do cp "$f" "$S/g2-seed-$p.${f##*.}"; done
    rm -f $D/learned-s$s.order.jsonl
    ORDER_LABEL=learned-s$s LEARN_SHARED_ARGS="$(shuffle $s)" learned_run $s $D/learned-s$s.json $S/g2-seed-$p
    echo "learned-s$s,learned,$s,${secs:-NA},$([ -n "$secs" ] && echo ok || echo failed)" >> $D/runs.csv
    echo "G2 $p learned-s$s (harness): ${secs:-NA}s"
  fi
}

for p in "$@"; do
  D=$OUT/$p; mkdir -p $D/learn
  notes=$D/notes.txt
  record_env "$D/env-$(date +%Y%m%d-%H%M%S).json"
  echo "label,kind,seed,seconds,status" > $D/runs.csv
  jsonl=$D/learning.jsonl
  source "$RESEARCH_DIR/learned-emulation.sh"
  started=$(date +%s); longest=0; isolong=0; isos=0
  t0=$(date +%s); iso 1; isolong=$(( $(date +%s) - t0 ))
  [ "$LEARNED" = 1 ] && learning
  # References after every <every> seeds, the last at the end.
  k=${#seeds[@]}; every=$k; [ $ISO_RUNS -gt 1 ] && every=$(( (k + ISO_RUNS - 2) / (ISO_RUNS - 1) ))
  i=0; ran=()
  for s in "${seeds[@]}"; do
    left=$(( ISO_RUNS - isos ))
    if [ -n "$BUDGET_MIN" ] && [ $(( $(date +%s) - started + longest + left * isolong )) -gt $(( BUDGET_MIN * 60 )) ]; then
      echo "BUDGET: $p stopped before seed $s ($(( ($(date +%s) - started) / 60 )) min used, a seed takes up to $(( longest / 60 )) min, $left reference run(s) left, budget $BUDGET_MIN min)" | tee -a "$notes" >&2
      break
    fi
    t0=$(date +%s)
    shared $s
    [ "$LEARNED" = 1 ] && learned $s
    took=$(( $(date +%s) - t0 )); [ $took -gt $longest ] && longest=$took
    i=$((i + 1)); ran+=("$s")
    if [ $isos -lt $ISO_RUNS ] && [ $(( i % every )) = 0 ] && [ $i -lt $k ]; then
      t0=$(date +%s); iso $((isos + 1)); took=$(( $(date +%s) - t0 )); [ $took -gt $isolong ] && isolong=$took
    fi
  done
  while [ $isos -lt $ISO_RUNS ]; do iso $((isos + 1)); done
  # The candidates' test files, isolated again.
  files=$(nodex "$RESEARCH_DIR/g2-report.cjs" files $D)
  if [ -n "$files" ]; then
    for n in $(seq 1 $CONFIRM_RUNS); do
      t=$(labelled confirm-$n --environment warpdom --first-setup $ORDER --extra-args "--passWithNoTests $files")
      done_run confirm-$n confirm "" "$t"
    done
  fi
  echo "G2 $p done: seeds ${ran[*]}, $isos reference run(s), $(count $files) candidate file(s)"
done
echo "G2 done"
