#!/usr/bin/env bash
# Core of timing-vitest.sh and timing-jest.sh (use those): suite timing
# rounds with jsdom and warpdom alternating.
#
#   CONFIGS="jsdom-default warpdom-default" scripts/research/timing-rounds.sh <csv> <rounds> <project...>
#
# Per round, per project, each configuration in CONFIGS in turn
# (<jsdom|warpdom>-<default|vm>; vm adds --pool=vmThreads, Vitest only).
# Appends round,project,config,seconds,differs to <csv> (created with a
# header if missing); seconds is the runner time the harness reports summed
# over the project's packages; differs counts tests whose status differs
# from the project's jsdom baseline. The run's environment is written to
# <csv without .csv>.env-<timestamp>.json. Summarize with
# scripts/research/timing-report.cjs (medians).
#
# A project is built (corpus.json "build") before its first run only. With
# no jsdom baseline yet (a fresh machine, e.g. CI), the first jsdom run
# becomes the baseline the differences are counted against.
[ $# -ge 3 ] || { echo "usage: CONFIGS=... timing-rounds.sh <csv> <rounds> <project...>" >&2; exit 2; }
case $1 in /*) csv=$1;; *) csv=$PWD/$1;; esac; shift
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
rounds=$1; shift
CONFIGS=${CONFIGS:-"jsdom-default warpdom-default jsdom-vm warpdom-vm"}
mkdir -p "$(dirname "$csv")"
[ -f "$csv" ] || echo "round,project,config,seconds,differs" > "$csv"
record_env "${csv%.csv}.env-$(date +%Y%m%d-%H%M%S).json"
built=" "
for round in $(seq 1 $rounds); do
  for project in "$@"; do
    base=$(baseline_dir $project)
    for cfg in $CONFIGS; do
      build=""
      case "$built" in *" $project "*) build="--no-build";; *) built="$built$project ";; esac
      env=${cfg%-*}; extra=""
      [ "${cfg#*-}" = "vm" ] && extra="--pool=vmThreads"
      out=$ENV_DIR/timing-$cfg
      rm -rf $out
      log=$(harness --only $project --environment $env --out $out --max-workers 2 --timeout 20 $build ${extra:+--extra-args "$extra"} 2>&1)
      if [ "$env" = jsdom ] && ! ls "$base"/*.jsdom.json >/dev/null 2>&1; then
        base=$ENV_DIR/jsdom-time/tmp/$project
        mkdir -p "$base" && cp "$out/tmp/$project"/*.jsdom.json "$base"/ 2>/dev/null
      fi
      secs=$(echo "$log" | runner_seconds)
      # No time: the harness failed; show why.
      [ -n "$secs" ] || { echo "harness output for $project $cfg:"; echo "$log" | tail -40; } >&2
      differs=$(node -e '
        const fs=require("fs");const [base,run,env]=process.argv.slice(1);
        const load=(dir,suffix)=>{const m=new Map();if(!fs.existsSync(dir))return m;for(const f of fs.readdirSync(dir).filter(n=>n.endsWith(suffix))){const r=JSON.parse(fs.readFileSync(dir+"/"+f));for(const t of r.testResults){const fn=t.name.split(/\/(packages|src|test|tests|examples)\//).pop();for(const a of t.assertionResults)m.set(f.split(".")[0]+"::"+fn+"::"+a.fullName,a.status)}}return m};
        const b=load(base,".jsdom.json"),w=load(run,"."+env+".json");let d=0;for(const k of new Set([...b.keys(),...w.keys()]))if(b.get(k)!==w.get(k))d++;console.log(d)' $base $out/tmp/$project $env)
      echo "$round,$project,$cfg,${secs:-NA},$differs" >> "$csv"
      echo "TIMING round $round $project $cfg: ${secs:-NA}s, $differs differ"
    done
  done
done
echo "TIMING done"
