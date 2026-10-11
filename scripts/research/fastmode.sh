#!/usr/bin/env bash
# Fast mode with a plain safety net (Vitest; superseded by learned.sh, kept
# to reproduce the "fast + safety net" numbers in warpdom's
# docs/head-to-head.md).
#
#   scripts/research/fastmode.sh <csv> <rounds> <project...>
#
# Per round and project: jsdom default (isolated; also this round's
# baseline), then jsdom and warpdom each without isolation (warpdom with
# its per-file reset, src/vitest-reset.js) with failing files rerun isolated
# and merged. Appends round,project,config,seconds,differs,rerun_files to
# <csv> and records the environment next to it. See lib.sh for the
# environment variables.
[ $# -ge 3 ] || { echo "usage: fastmode.sh <csv> <rounds> <project...>" >&2; exit 2; }
case $1 in /*) csv=$1;; *) csv=$PWD/$1;; esac; shift
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
S=$WORK_DIR
W=$WARPDOM_DIR
rounds=$1; shift
mkdir -p "$(dirname "$csv")"
[ -f "$csv" ] || echo "round,project,config,seconds,differs,rerun_files" > "$csv"
record_env "${csv%.csv}.env-$(date +%Y%m%d-%H%M%S).json"
# Runs the harness; prints the runner time it reports, summed over packages.
timed() { harness --max-workers 2 --timeout 20 "$@" 2>&1 | runner_seconds; }
statuses() { node -e '
  const fs=require("fs");const [dir,env,out]=process.argv.slice(1);const m={};
  if(fs.existsSync(dir))for(const f of fs.readdirSync(dir).filter(n=>n.endsWith("."+env+".json"))){const r=JSON.parse(fs.readFileSync(dir+"/"+f));for(const t of r.testResults){for(const a of t.assertionResults)m[t.name+"::"+a.fullName]={s:a.status,file:t.name}}}
  fs.writeFileSync(out,JSON.stringify(m))' "$@"; }
for round in $(seq 1 $rounds); do
  for p in "$@"; do
    base=$ENV_DIR/fm-base
    rm -rf $base
    t=$(timed --only $p --environment jsdom --out $base)
    statuses $base/tmp/$p jsdom $S/fm-base.json
    echo "$round,$p,jsdom-default,${t:-NA},0,0" >> "$csv"
    echo "FAST round $round $p jsdom-default: ${t:-NA}s"
    for env in jsdom warpdom; do
      fast=$ENV_DIR/fm-fast; rerun=$ENV_DIR/fm-rerun
      rm -rf $fast $rerun
      first=""; [ $env = warpdom ] && first="--first-setup $W/src/vitest-reset.js"
      t=$(timed --only $p --environment $env --out $fast --extra-args "--no-isolate" $first)
      statuses $fast/tmp/$p $env $S/fm-fast.json
      failing=$(node -e 'const m=require(process.argv[1]);console.log([...new Set(Object.values(m).filter(v=>v.s==="failed").map(v=>v.file))].join(" "))' $S/fm-fast.json)
      n=$(echo $failing | wc -w | tr -d ' ')
      tr=0; [ "$n" != "0" ] && tr=$(timed --only $p --environment $env --out $rerun --extra-args "$failing")
      total=$(echo "${t:-0} + ${tr:-0}" | bc)
      statuses $rerun/tmp/$p $env $S/fm-rerun.json
      differs=$(node -e '
        const [b,f,r]=process.argv.slice(1).map(x=>require(x));const rerunFiles=new Set(Object.values(r).map(v=>v.file));
        const merged={};for(const [k,v] of Object.entries(f))if(!rerunFiles.has(v.file))merged[k]=v.s;for(const [k,v] of Object.entries(r))merged[k]=v.s;
        let d=0;for(const k of new Set([...Object.keys(b),...Object.keys(merged)]))if(b[k]?.s!==merged[k])d++;console.log(d)' $S/fm-base.json $S/fm-fast.json $S/fm-rerun.json)
      echo "$round,$p,$env-fast-net,$total,$differs,$n" >> "$csv"
      echo "FAST round $round $p $env-fast-net: ${total}s, $differs differ, $n files rerun"
    done
  done
done
echo "FAST done"
