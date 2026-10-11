#!/usr/bin/env bash
# Same-status survey: runs each corpus project on warpdom (isolated, 2
# workers) and counts tests whose status differs from the project's jsdom
# baseline. Projects without a jsdom baseline get one first.
#
#   scripts/research/survey-warpdom.sh <project...>   (names from corpus/corpus.json)
#   WARPDOM_DIR=~/Projects/warpdom-branch scripts/research/survey-warpdom.sh vuetify
#
# Prints one "SURVEY <project> jsdom passed N | warpdom passed N | differ N |
# tests N" line per project (tee it into a log). Results stay in
# $ENV_DIR/survey-warpdom/<project>-run (scripts/research/diffgroups.cjs
# groups the differences); the run's environment is written to
# $ENV_DIR/survey-warpdom/environment-<timestamp>.json. See lib.sh for the
# environment variables.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

mkdir -p "$ENV_DIR/survey-warpdom"
record_env "$ENV_DIR/survey-warpdom/environment-$(date +%Y%m%d-%H%M%S).json"
for p in "$@"; do
  base=$ENV_DIR/jsdom-time/tmp/$p
  if ! ls $base/*.jsdom.json >/dev/null 2>&1; then
    rm -rf $ENV_DIR/jsdom-base/$p-run
    harness --only $p --environment jsdom --out $ENV_DIR/jsdom-base/$p-run --max-workers 2 --timeout 15 > /dev/null 2>&1
    base=$ENV_DIR/jsdom-base/$p-run/tmp/$p
  fi
  out=$ENV_DIR/survey-warpdom/$p-run
  rm -rf $out
  log=$(harness --only $p --environment warpdom --out $out --max-workers 2 --timeout 15 2>&1)
  node -e '
    const fs=require("fs");const [p,base,run]=process.argv.slice(1);
    const load=(dir,suffix)=>{const m=new Map();if(!fs.existsSync(dir))return m;for(const f of fs.readdirSync(dir).filter(n=>n.endsWith(suffix))){const r=JSON.parse(fs.readFileSync(dir+"/"+f));for(const t of r.testResults){const fn=t.name.split(/\/(packages|src|test|tests)\//).pop();if(!t.assertionResults.length)m.set(f.split(".")[0]+"::"+fn+"::(file)",t.status);for(const a of t.assertionResults)m.set(f.split(".")[0]+"::"+fn+"::"+a.fullName,a.status)}}return m};
    const b=load(base,".jsdom.json"),w=load(run,".warpdom.json");
    let d=0,passB=0,passW=0;for(const k of new Set([...b.keys(),...w.keys()])){if(b.get(k)!==w.get(k))d++;}
    for(const v of b.values())if(v==="passed")passB++;for(const v of w.values())if(v==="passed")passW++;
    console.log("SURVEY",p.padEnd(22),"jsdom passed",passB,"| warpdom passed",passW,"| differ",d,"| tests",b.size)' $p $base $out/tmp/$p
  echo "$log" | grep -E "^\s+(failed|skipped)" | sed "s/^/  $p: /" | head -5
done
echo "SURVEY done"
