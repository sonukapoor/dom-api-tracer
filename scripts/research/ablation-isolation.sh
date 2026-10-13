#!/usr/bin/env bash
# Strong baselines and the ablation of learned isolation on Vitest suites
# (warpdom docs/research/revision-plan.md items 1-8, ablation-plan.md A1).
#
#   [CONFIGS="..."] scripts/research/ablation-isolation.sh <csv> <rounds> <project...>
#
# Configurations (CONFIGS, default all, in this order):
#   jsdom-default        jsdom, Vitest's isolation (the baseline)
#   jsdom-shared         jsdom without isolation (--no-isolate)
#   jsdom-vm             jsdom, --pool=vmThreads
#   warpdom-default      warpdom, Vitest's isolation
#   warpdom-vm           warpdom, --pool=vmThreads
#   warpdom-sharedfresh  warpdom without isolation, a new window per file
#                        (WARPDOM_ABLATE=fresh-window, warpdom's reset first)
#   warpdom-sharedreset  warpdom without isolation, warpdom's in-place reset
#   warpdom-learned      warpdom's fast mode (learned isolation), see below
#   happydom-shared      happy-dom without isolation (--no-isolate); happy-dom
#                        is linked from this repository when the project lacks it
#
# Protocol, per project: one untimed warm-up run of every configuration
# (rows in <csv>.warmup.csv; for warpdom-learned the warm-up is the first
# learning, whose state the timed learned runs start from), then <rounds>
# rounds. Each round re-learns from scratch (untimed for the table,
# recorded) and then runs every configuration once, the order rotated by
# one position per round (rotate in lib.sh; the position is in the CSV).
# A run that fails or times out (a package without results) records NA,
# and the reason goes to stderr and <csv>.notes.txt.
#
# Output (appended; <csv> is created with a header if missing):
#   <csv>  round,project,config,seconds,differs,files_differ,false_pass,
#          false_fail,ref,position,method
#     differs: tests whose status differs from this round's jsdom-default
#     run; files_differ: test files whose (file-level) status differs;
#     false_pass / false_fail: tests passed in this configuration but not
#     (failed, skipped or missing) in ref, and the reverse, ref being the
#     same DOM's isolated run of this round (warpdom-default for warpdom-*,
#     jsdom-default for jsdom-* and happydom-shared). For warpdom-learned,
#     false_pass counts the violations of G2 (a test that passes only
#     because files shared a window).
#     method (warpdom-learned): cli or harness, see below.
#   <csv>.learning.jsonl  every learning and learned run (learning.cjs)
#   <csv>.warmup.csv      the warm-up runs (the CSV's columns)
#   $PERTEST_DIR/<round>/<project>/<config>.json  (default <csv>.pertest)
#     every run's per-test statuses (statuses.cjs map form; round 0 is the
#     warm-up; learn-*.json are the learning runs)
#
# warpdom-learned is the shipped product where possible: `warpdom vitest
# run` (warpdom src/vitest-fast-cli.js + src/vitest-fast.js, Vitest >= 3.2)
# through trace-corpus.mjs --fast-cli, with its state kept between runs
# (method cli). Learning is `warpdom vitest run --learn` from an empty
# state; the timed run is a normal `warpdom vitest run` on the state from
# the warm-up learning, which the CLI itself updates with newly leaking
# files. The CLI's time includes its safety-net reruns.
#
# Projects where the CLI cannot run fall back to this script's emulation of
# it (method harness): Vitest < 3.2, more than one --project argument
# (withFastMode splits one project), or a config withFastMode does not
# accept (the CLI's learning run fails). FAST_CLI=0 forces the emulation.
# The emulation follows the CLI's logic (warpdom state version 2):
#   learning: an isolated run (t_iso), a run without isolation with the
#     reset (t_sh), stopped at 1.25 x t_iso + 10 s; files to isolate = files
#     failing without isolation or whose tests' statuses differ from
#     isolated (a missing test or file counts); the split (t_split), whose
#     results must equal isolated (files still differing join, once, else
#     isolated); mode = split only if t_split beats t_iso by 5% and 0.5 s;
#     a missing time or a stopped run means isolated.
#   run: mode isolated: an isolated run. Mode split: the files to isolate
#     isolated, the rest shared with the reset (stopped at 1.5 x t_iso +
#     30 s: then an isolated run, and isolated from then on); files failing
#     in the shared part are re-run isolated, their isolated result counts,
#     and they are isolated from then on; a split no faster than t_iso
#     switches to isolated.
# Remaining differences from the CLI: the split is two runner processes
# (the shared part, then the isolated files, run with --passWithNoTests
# and the file list for every package of the project) where the CLI runs
# one Vitest process with two projects, so the emulation's split pays one
# extra Vitest startup per package; its seconds are the sum of the runner
# times the harness reports, the CLI's the CLI's wall time.
#
# TIMEOUT_MIN (default 45) per harness run. BUDGET_MIN (optional): stop
# before a round that would not finish within this many minutes of the
# start (estimated from the longest round so far), so a CI job ends with
# complete rounds and uploads them instead of hitting its time limit; the
# stop is noted in <csv>.notes.txt. See lib.sh for the rest.
[ $# -ge 3 ] || { echo "usage: [CONFIGS=...] ablation-isolation.sh <csv> <rounds> <project...>" >&2; exit 2; }
case $1 in /*) csv=$1;; *) csv=$PWD/$1;; esac; shift
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
S=$WORK_DIR
W=$WARPDOM_DIR
E=$ENV_DIR
rounds=$1; shift
ALL="jsdom-default jsdom-shared jsdom-vm warpdom-default warpdom-vm warpdom-sharedfresh warpdom-sharedreset warpdom-learned happydom-shared"
CONFIGS=${CONFIGS:-$ALL}
for c in $CONFIGS; do
  case " $ALL " in *" $c "*) ;; *) echo "unknown configuration $c (known: $ALL)" >&2; exit 2;; esac
done
read -r -a configs <<< "$CONFIGS"
mkdir -p "$(dirname "$csv")"
HEADER="round,project,config,seconds,differs,files_differ,false_pass,false_fail,ref,position,method"
[ -f "$csv" ] || echo "$HEADER" > "$csv"
warmcsv=${csv%.csv}.warmup.csv
[ -f "$warmcsv" ] || echo "$HEADER" > "$warmcsv"
jsonl=${csv%.csv}.learning.jsonl
notes=${csv%.csv}.notes.txt
PT=${PERTEST_DIR:-${csv%.csv}.pertest}
mkdir -p "$PT" && PT=$(cd "$PT" && pwd)
record_env "${csv%.csv}.env-$(date +%Y%m%d-%H%M%S).json"
first="--first-setup $W/src/vitest-reset.js"
rm -f $S/ab-built-*

# run <out> <harness args...>: one harness run of project $p into $E/<out>
# (built before its first run only); prints its seconds, or nothing if it
# failed. The output is kept in $S/ab-<out>.log and appended to $S/ablation.log.
run() {
  local out=$1; shift
  local build="--no-build"; [ -f $S/ab-built-$p ] || build=""
  rm -rf "$E/$out"
  harness --max-workers 2 --timeout ${TIMEOUT_MIN:-45} $build --only $p --out "$E/$out" "$@" > "$S/ab-$out.log" 2>&1
  touch $S/ab-built-$p
  cat "$S/ab-$out.log" >> "$S/ablation.log"
  complete_seconds < "$S/ab-$out.log"
}
# na <round> <label> <out>: why a run has no time.
na() {
  { echo "NA round $1 $p $2: $(grep -E '^\s+failed|fast-cli' "$S/ab-$3.log" | tr -s ' ' | paste -sd'|' -)"
    tail -25 "$S/ab-$3.log" | sed 's/^/    /'; } | tee -a "$notes" >&2
}
add() { local x; [ -n "$1" ] && [ -n "$2" ] && x=$(echo "$1 + $2" | bc) && echo "$x"; }
excludes() { for f in "$@"; do printf -- "--exclude %s " "$f"; done; }
count() { echo $# ; }

# --- warpdom-learned --------------------------------------------------------

# learn_cli <round> <state dir> <map out>: `warpdom vitest run --learn` from scratch.
learn_cli() {
  rm -rf "$2"; mkdir -p "$2"
  local t; t=$(run ab-learn --environment warpdom --fast-cli learn --fast-state "$2")
  status_map $E/ab-learn/tmp/$p warpdom "$3" $p
  nodex "$RESEARCH_DIR/learning.cjs" cli $E/ab-learn/tmp/$p "$jsonl" $1 $p learn
  [ -n "$t" ] || na $1 learning ab-learn
  [ -n "$t" ]
}
# The emulation (rules, learning, learned runs): learned-emulation.sh.
source "$RESEARCH_DIR/learned-emulation.sh"

# The first learning (the warm-up of warpdom-learned): the state the timed
# runs start from, and the method (cli or harness) for the project.
first_learning() {
  local md=$PT/0/$p
  if [ "${FAST_CLI:-1}" != 0 ] && learn_cli 0 $S/ab-state/$p $md/learn.json; then
    echo cli > $S/ab-method-$p
    echo "LEARN round 0 $p (warpdom vitest run --learn): $(cat $S/ab-state/$p/*.json | grep -c '"mode"') package(s), modes $(grep -ho '"mode": "[a-z]*"' $S/ab-state/$p/*.json | cut -d'"' -f4 | paste -sd, -)"
  else
    local why="FAST_CLI=0"; [ "${FAST_CLI:-1}" != 0 ] && why=$(grep -hoE 'fast-cli[^,]*|failed .*' $S/ab-ab-learn.log | head -3 | paste -sd'|' -)
    echo "METHOD $p: harness emulation of warpdom vitest run ($why)" | tee -a "$notes"
    echo harness > $S/ab-method-$p
    learn_harness 0 $S/ab-state-$p $md
  fi
}

# --- one configuration --------------------------------------------------------

# run_config <round> <config>: runs it; sets secs; writes the status map.
run_config() {
  local r=$1 c=$2 md=$PT/$1/$p env=warpdom
  mkdir -p $md
  secs=""
  case $c in
    jsdom-default) env=jsdom; secs=$(run ab-run --environment jsdom);;
    jsdom-shared) env=jsdom; secs=$(run ab-run --environment jsdom --extra-args "--no-isolate");;
    jsdom-vm) env=jsdom; secs=$(run ab-run --environment jsdom --extra-args "--pool=vmThreads");;
    warpdom-default) secs=$(run ab-run --environment warpdom);;
    warpdom-vm) secs=$(run ab-run --environment warpdom --extra-args "--pool=vmThreads");;
    warpdom-sharedfresh) secs=$(WARPDOM_ABLATE=fresh-window run ab-run --environment warpdom --extra-args "--no-isolate" $first);;
    warpdom-sharedreset) secs=$(run ab-run --environment warpdom --extra-args "--no-isolate" $first);;
    happydom-shared) env=happy-dom; secs=$(run ab-run --environment happy-dom --extra-args "--no-isolate");;
    warpdom-learned)
      if [ $r = 0 ]; then
        first_learning
        # The warm-up of the learned configuration is its learning: no timed row.
        secs=learning; return
      fi
      learned_run $r $md/$c.json; return;;
  esac
  status_map $E/ab-run/tmp/$p $env $md/$c.json $p
  [ -n "$secs" ] || na $r $c ab-run
}

# rows <round> <file>: compares the round's runs with its jsdom-default run
# and appends a row per configuration.
rows() {
  local r=$1 out=$2 md=$PT/$1/$p pos=0 c ref cmp method t d fd fp ff
  for c in $order; do
    pos=$((pos + 1))
    t=$(cat $S/ab-t-$c 2>/dev/null)
    [ "$t" = learning ] && continue
    case $c in warpdom-*) ref=warpdom-default;; *) ref=jsdom-default;; esac
    [ $c = $ref ] && ref=""
    if [ -f $md/jsdom-default.json ] && [ -f $md/$c.json ]; then
      if [ -n "$ref" ] && [ -f $md/$ref.json ]; then cmp=$(statuses compare $md/jsdom-default.json $md/$c.json $md/$ref.json)
      else cmp="$(statuses compare $md/jsdom-default.json $md/$c.json) NA NA"; fi
    else cmp="NA NA NA NA"; fi
    read -r d fd fp ff <<< "$cmp"
    method=""; [ $c = warpdom-learned ] && method=$(cat $S/ab-method-$p)
    echo "$r,$p,$c,${t:-NA},$d,$fd,$fp,$ff,$ref,$pos,$method" >> "$out"
    echo "ABLATION round $r $p $c: ${t:-NA}s, $d tests / $fd files differ, $fp false passes, $ff false fails${ref:+ (vs $ref)}"
  done
}

started=$(date +%s); longest=0
for round in $(seq 0 $rounds); do
  now=$(date +%s)
  if [ -n "$BUDGET_MIN" ] && [ $round -gt 0 ] && [ $(( now - started + longest )) -gt $(( BUDGET_MIN * 60 )) ]; then
    echo "BUDGET: stopped before round $round of $rounds ($(( (now - started) / 60 )) min used, rounds take up to $(( longest / 60 )) min, budget $BUDGET_MIN min): $*" | tee -a "$notes" >&2
    break
  fi
  # Round 0 is the warm-up, in the configured order.
  order=$CONFIGS; [ $round -gt 0 ] && order=$(rotate $round "${configs[@]}")
  for p in "$@"; do
    rm -f $S/ab-t-*
    if [ $round -gt 0 ] && [[ " $CONFIGS " == *" warpdom-learned "* ]]; then
      # Learning from scratch every round (stability); the timed learned
      # runs keep the warm-up's state.
      if [ "$(cat $S/ab-method-$p)" = cli ]; then learn_cli $round $S/ab-relearn/$p $PT/$round/$p/learn.json || true
      else learn_harness $round $S/ab-relearn-$p $PT/$round/$p; fi
    fi
    for c in $order; do
      run_config $round $c
      echo "$secs" > $S/ab-t-$c
    done
    if [ $round = 0 ]; then rows 0 "$warmcsv"; else rows $round "$csv"; fi
  done
  took=$(( $(date +%s) - now )); [ $took -gt $longest ] && longest=$took
  echo "ABLATION round $round took $(( took / 60 )) min"
done
echo "ABLATION done"
