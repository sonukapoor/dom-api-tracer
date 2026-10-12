#!/usr/bin/env bash
# Ablation of learned isolation (warpdom docs/research/ablation-plan.md, A1):
# what each part of warpdom's fast mode contributes, on Vitest suites.
#
#   scripts/research/ablation-isolation.sh <csv> <rounds> <project...>
#
# Per project, first the learning (as learned.sh): warpdom without isolation
# finds the leaky files. Then per round, alternating on one machine:
#   jsdom-default          jsdom, Vitest's isolation (the baseline)
#   warpdom-default        warpdom, Vitest's isolation
#   jsdom-shared           jsdom without isolation (--no-isolate), no reset
#   warpdom-sharedfresh    warpdom without isolation, a new window per file
#                          (WARPDOM_ABLATE=fresh-window)
#   warpdom-sharedreset    warpdom without isolation, the in-place reset
#   warpdom-learned        leaky files isolated, the rest shared with the
#                          reset, new failures re-run isolated (fast mode)
# Appends round,project,config,seconds,differs to <csv>; differs counts tests
# whose status differs from that round's jsdom-default run. Summarize with
# timing-report.cjs. Learned state stays in $WORK_DIR as with learned.sh.
[ $# -ge 3 ] || { echo "usage: ablation-isolation.sh <csv> <rounds> <project...>" >&2; exit 2; }
case $1 in /*) csv=$1;; *) csv=$PWD/$1;; esac; shift
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
S=$WORK_DIR
W=$WARPDOM_DIR
E=$ENV_DIR
rounds=$1; shift
mkdir -p "$(dirname "$csv")"
[ -f "$csv" ] || echo "round,project,config,seconds,differs" > "$csv"
record_env "${csv%.csv}.env-$(date +%Y%m%d-%H%M%S).json"
timed() { harness --max-workers 2 --timeout ${TIMEOUT_MIN:-45} "$@" 2>&1 | tee -a $S/ablation-last.log | runner_seconds; }
statuses() { node -e '
  const fs=require("fs");const [dir,env,out]=process.argv.slice(1);const m={};
  if(fs.existsSync(dir))for(const f of fs.readdirSync(dir).filter(n=>n.endsWith("."+env+".json"))){const r=JSON.parse(fs.readFileSync(dir+"/"+f));for(const t of r.testResults){m[t.name+"::(file)"]={s:t.status,file:t.name};for(const a of t.assertionResults)m[t.name+"::"+a.fullName]={s:a.status,file:t.name}}}
  fs.writeFileSync(out,JSON.stringify(m))' "$@"; }
failingFiles() { node -e 'const m=require(process.argv[1]);console.log([...new Set(Object.values(m).filter(v=>v.s==="failed").map(v=>v.file))].join(" "))' $1; }
differs() { node -e 'const [b,w]=process.argv.slice(1).map(x=>require(x));let d=0;for(const k of new Set([...Object.keys(b),...Object.keys(w)]))if(b[k]?.s!==w[k]?.s)d++;console.log(d)' "$@"; }
excludes() { for f in "$@"; do printf -- "--exclude %s " "$f"; done; }
first="--first-setup $W/src/vitest-reset.js"
row() { echo "$1,$2,$3,${4:-NA},$5" >> "$csv"; echo "ABLATION round $1 $2 $3: ${4:-NA}s, $5 differ"; }

for p in "$@"; do
  # Learning: the files that fail without isolation are leaky.
  rm -rf $E/ab-learn
  timed --only $p --environment warpdom --out $E/ab-learn --extra-args "--no-isolate" $first >/dev/null
  statuses $E/ab-learn/tmp/$p warpdom $S/ab-learn.json
  failingFiles $S/ab-learn.json > $S/ab-leaky-$p.txt
  echo "LEARN $p: $(wc -w < $S/ab-leaky-$p.txt | tr -d ' ') leaky files"
done

for round in $(seq 1 $rounds); do
  for p in "$@"; do
    rm -rf $E/ab-*-run
    t=$(timed --only $p --environment jsdom --out $E/ab-base-run)
    statuses $E/ab-base-run/tmp/$p jsdom $S/ab-base.json
    row $round $p jsdom-default "$t" 0

    t=$(timed --only $p --environment warpdom --out $E/ab-iso-run)
    statuses $E/ab-iso-run/tmp/$p warpdom $S/ab-x.json
    row $round $p warpdom-default "$t" $(differs $S/ab-base.json $S/ab-x.json)

    t=$(timed --only $p --environment jsdom --out $E/ab-jshared-run --extra-args "--no-isolate")
    statuses $E/ab-jshared-run/tmp/$p jsdom $S/ab-x.json
    row $round $p jsdom-shared "$t" $(differs $S/ab-base.json $S/ab-x.json)

    t=$(WARPDOM_ABLATE=fresh-window timed --only $p --environment warpdom --out $E/ab-fresh-run --extra-args "--no-isolate" $first)
    statuses $E/ab-fresh-run/tmp/$p warpdom $S/ab-x.json
    row $round $p warpdom-sharedfresh "$t" $(differs $S/ab-base.json $S/ab-x.json)

    t=$(timed --only $p --environment warpdom --out $E/ab-reset-run --extra-args "--no-isolate" $first)
    statuses $E/ab-reset-run/tmp/$p warpdom $S/ab-x.json
    row $round $p warpdom-sharedreset "$t" $(differs $S/ab-base.json $S/ab-x.json)

    # Learned: leaky files isolated, the rest shared; new failures re-run isolated.
    leaky=$(cat $S/ab-leaky-$p.txt)
    nleaky=$(echo $leaky | wc -w | tr -d ' ')
    t1=$(timed --only $p --environment warpdom --out $E/ab-lfast-run --extra-args "--no-isolate $(excludes $leaky)" $first)
    t2=0; [ "$nleaky" != "0" ] && t2=$(timed --only $p --environment warpdom --out $E/ab-liso-run --extra-args "$leaky")
    statuses $E/ab-lfast-run/tmp/$p warpdom $S/ab-lfast.json
    statuses $E/ab-liso-run/tmp/$p warpdom $S/ab-liso.json
    new=$(failingFiles $S/ab-lfast.json)
    nnew=$(echo $new | wc -w | tr -d ' ')
    t3=0; [ "$nnew" != "0" ] && t3=$(timed --only $p --environment warpdom --out $E/ab-lrerun-run --extra-args "$new")
    statuses $E/ab-lrerun-run/tmp/$p warpdom $S/ab-lrerun.json
    [ "$nnew" != "0" ] && echo "$leaky $new" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ' > $S/ab-leaky-$p.txt
    total=""; [ -n "$t1" ] && total=$(echo "${t1:-0} + ${t2:-0} + ${t3:-0}" | bc)
    d=$(node -e '
      const [b,f,i,r]=process.argv.slice(1).map(x=>require(x));const replaced=new Set([...Object.values(i),...Object.values(r)].map(v=>v.file));
      const merged={};for(const [k,v] of Object.entries(f))if(!replaced.has(v.file))merged[k]=v.s;for(const src of [i,r])for(const [k,v] of Object.entries(src))merged[k]=v.s;
      let d=0;for(const k of new Set([...Object.keys(b),...Object.keys(merged)]))if(b[k]?.s!==merged[k])d++;console.log(d)' $S/ab-base.json $S/ab-lfast.json $S/ab-liso.json $S/ab-lrerun.json)
    row $round $p warpdom-learned "$total" $d
    echo "ABLATION round $round $p learned: $nleaky isolated, $nnew new leaks"
  done
done
echo "ABLATION done"
