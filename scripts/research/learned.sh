#!/usr/bin/env bash
# Learning fast mode (Vitest): the experiment behind warpdom's
# `warpdom vitest run` (docs/fast-mode.md) and the "learned" table in
# docs/head-to-head.md.
#
#   scripts/research/learned.sh <csv> <rounds> <project...>
#
# Per project, an untimed learning run (warpdom without isolation; files
# that fail are the leaky ones) plus timed isolated and split runs; the
# cheaper mode is kept. Then per round: jsdom default (timed; this round's
# baseline) and warpdom's steady state: leaky files isolated, the rest
# without isolation with warpdom's reset (src/vitest-reset.js), new
# failures rerun isolated and learned. Appends
# round,project,config,seconds,differs,isolated_files,new_leaks to <csv>
# and records the environment next to it. Learned state (leaky-<p>.txt,
# mode-<p>.txt) stays in $WORK_DIR. See lib.sh for the environment variables.
[ $# -ge 3 ] || { echo "usage: learned.sh <csv> <rounds> <project...>" >&2; exit 2; }
case $1 in /*) csv=$1;; *) csv=$PWD/$1;; esac; shift
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
S=$WORK_DIR
W=$WARPDOM_DIR
E=$ENV_DIR
rounds=$1; shift
mkdir -p "$(dirname "$csv")"
[ -f "$csv" ] || echo "round,project,config,seconds,differs,isolated_files,new_leaks" > "$csv"
record_env "${csv%.csv}.env-$(date +%Y%m%d-%H%M%S).json"
timed() { harness --max-workers 2 --timeout 20 "$@" 2>&1 | runner_seconds; }
statuses() { node -e '
  const fs=require("fs");const [dir,env,out]=process.argv.slice(1);const m={};
  if(fs.existsSync(dir))for(const f of fs.readdirSync(dir).filter(n=>n.endsWith("."+env+".json"))){const r=JSON.parse(fs.readFileSync(dir+"/"+f));for(const t of r.testResults){m[t.name+"::(file)"]={s:t.status,file:t.name};for(const a of t.assertionResults)m[t.name+"::"+a.fullName]={s:a.status,file:t.name}}}
  fs.writeFileSync(out,JSON.stringify(m))' "$@"; }
failingFiles() { node -e 'const m=require(process.argv[1]);console.log([...new Set(Object.values(m).filter(v=>v.s==="failed").map(v=>v.file))].join(" "))' $1; }
# --exclude for files, by absolute path (exactly those files).
excludes() { for f in "$@"; do printf -- "--exclude %s " "$f"; done; }
first="--first-setup $W/src/vitest-reset.js"
# The split: fast mode for all but the leaky files, which run isolated.
split() {
  local p=$1 leaky=$(cat $S/leaky-$1.txt) n
  n=$(echo $leaky | wc -w | tr -d ' ')
  rm -rf $E/lm-fast $E/lm-iso
  local t1 t2=0
  t1=$(timed --only $p --environment warpdom --out $E/lm-fast --extra-args "--no-isolate $(excludes $leaky)" $first)
  [ "$n" != "0" ] && t2=$(timed --only $p --environment warpdom --out $E/lm-iso --extra-args "$leaky")
  echo "${t1:-0} + ${t2:-0}" | bc
}
for p in "$@"; do
  # Learning: warpdom isolated, then without isolation (the files that fail
  # are leaky), then the split; the cheaper of isolated and split is kept.
  rm -rf $E/lm-learn
  ti=$(timed --only $p --environment warpdom --out $E/lm-learn)
  rm -rf $E/lm-learn
  timed --only $p --environment warpdom --out $E/lm-learn --extra-args "--no-isolate" $first >/dev/null
  statuses $E/lm-learn/tmp/$p warpdom $S/lm-learn.json
  failingFiles $S/lm-learn.json > $S/leaky-$p.txt
  ts=$(split $p)
  mode=split; [ "$(echo "${ti:-0} <= ${ts:-0}" | bc)" = "1" ] && mode=isolated
  echo $mode > $S/mode-$p.txt
  echo "LEARN $p: $(wc -w < $S/leaky-$p.txt | tr -d ' ') leaky files; isolated ${ti}s, split ${ts}s -> $mode"
done
for round in $(seq 1 $rounds); do
  for p in "$@"; do
    rm -rf $E/lm-base
    t=$(timed --only $p --environment jsdom --out $E/lm-base)
    statuses $E/lm-base/tmp/$p jsdom $S/lm-base.json
    echo "$round,$p,jsdom-default,${t:-NA},0,0,0" >> "$csv"
    echo "LEARNED round $round $p jsdom-default: ${t:-NA}s"
    if [ "$(cat $S/mode-$p.txt)" = "isolated" ]; then
      rm -rf $E/lm-wd
      t=$(timed --only $p --environment warpdom --out $E/lm-wd)
      statuses $E/lm-wd/tmp/$p warpdom $S/lm-wd.json
      differs=$(node -e 'const [b,w]=process.argv.slice(1).map(x=>require(x));let d=0;for(const k of new Set([...Object.keys(b),...Object.keys(w)]))if(b[k]?.s!==w[k]?.s)d++;console.log(d)' $S/lm-base.json $S/lm-wd.json)
      echo "$round,$p,warpdom-learned-isolated,${t:-NA},$differs,all,0" >> "$csv"
      echo "LEARNED round $round $p warpdom-learned (isolated): ${t:-NA}s, $differs differ"
      continue
    fi
    leaky=$(cat $S/leaky-$p.txt)
    nleaky=$(echo $leaky | wc -w | tr -d ' ')
    rm -rf $E/lm-fast $E/lm-iso $E/lm-rerun
    t1=$(timed --only $p --environment warpdom --out $E/lm-fast --extra-args "--no-isolate $(excludes $leaky)" $first)
    t2=0; [ "$nleaky" != "0" ] && t2=$(timed --only $p --environment warpdom --out $E/lm-iso --extra-args "$leaky")
    statuses $E/lm-fast/tmp/$p warpdom $S/lm-fast.json
    statuses $E/lm-iso/tmp/$p warpdom $S/lm-iso.json
    new=$(failingFiles $S/lm-fast.json)
    nnew=$(echo $new | wc -w | tr -d ' ')
    t3=0; [ "$nnew" != "0" ] && t3=$(timed --only $p --environment warpdom --out $E/lm-rerun --extra-args "$new")
    statuses $E/lm-rerun/tmp/$p warpdom $S/lm-rerun.json
    [ "$nnew" != "0" ] && echo "$leaky $new" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ' > $S/leaky-$p.txt
    total=$(echo "${t1:-0} + ${t2:-0} + ${t3:-0}" | bc)
    differs=$(node -e '
      const [b,f,i,r]=process.argv.slice(1).map(x=>require(x));const replaced=new Set([...Object.values(i),...Object.values(r)].map(v=>v.file));
      const merged={};for(const [k,v] of Object.entries(f))if(!replaced.has(v.file))merged[k]=v.s;for(const src of [i,r])for(const [k,v] of Object.entries(src))merged[k]=v.s;
      let d=0;for(const k of new Set([...Object.keys(b),...Object.keys(merged)]))if(b[k]?.s!==merged[k])d++;console.log(d)' $S/lm-base.json $S/lm-fast.json $S/lm-iso.json $S/lm-rerun.json)
    echo "$round,$p,warpdom-learned-split,$total,$differs,$nleaky,$nnew" >> "$csv"
    echo "LEARNED round $round $p warpdom-learned: ${total}s, $differs differ, $nleaky isolated, $nnew new leaks"
  done
done
echo "LEARNED done"
