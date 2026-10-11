#!/usr/bin/env bash
# Head-to-head (Vitest): jsdom, happy-dom and warpdom, each isolated,
# with --no-isolate, and in "fast" mode (--no-isolate plus per-file cleanup:
# a fresh window per file for jsdom and happy-dom via fresh/*.mjs,
# warpdom's in-place reset src/vitest-reset.js); interleaved rounds. The
# source of warpdom's docs/head-to-head.md (2026-10-09).
#
#   scripts/research/headtohead.sh <csv> [rounds=3]
#   SUITES="radix-primitives vuetify" scripts/research/headtohead.sh h2h.csv
#
# Writes round,suite,dom,mode,ms,passed,failed,tests,status rows to <csv>
# (overwritten) and keeps each run's raw results as
# $WORK_DIR/h2h-<round>-<suite>-<dom>-<mode>.json; records the environment
# next to the CSV. Supported suites: radix-primitives, vuetify,
# emoji-picker-element (add others to pkgdir below). Temporary files in
# the project checkouts are removed on exit. See lib.sh for the environment
# variables.
[ $# -ge 1 ] || { echo "usage: headtohead.sh <csv> [rounds]" >&2; exit 2; }
case $1 in /*) OUT=$1;; *) OUT=$PWD/$1;; esac
ROUNDS=${2:-3}
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
S=$WORK_DIR
SUITES=${SUITES:-"radix-primitives vuetify emoji-picker-element"}
pkgdir() { case $1 in radix-primitives) echo $REPOS_DIR/radix-primitives;; vuetify) echo $REPOS_DIR/vuetify/packages/vuetify;; emoji-picker-element) echo $REPOS_DIR/emoji-picker-element;; esac; }
cleanup() { for p in $SUITES; do rm -rf "$(pkgdir $p)/.dom-fresh"; done; rm -rf $REPOS_DIR/emoji-picker-element/.warpdom-tmp; }
trap cleanup EXIT
for p in $SUITES; do mkdir -p "$(pkgdir $p)/.dom-fresh"; cp $RESEARCH_DIR/fresh/fresh-jsdom.mjs $RESEARCH_DIR/fresh/fresh-happy-dom.mjs "$(pkgdir $p)/.dom-fresh/"; done
# emoji-picker uses Vitest 3, which cannot load a setup file or environment
# from outside the project with --no-isolate: use a warpdom copy inside it.
T=$REPOS_DIR/emoji-picker-element/.warpdom-tmp
if [[ " $SUITES " == *" emoji-picker-element "* ]]; then
  mkdir -p $T/node_modules; cp -R $WARPDOM_DIR/src $WARPDOM_DIR/package.json $T/; cp -R $WARPDOM_DIR/node_modules/parse5 $WARPDOM_DIR/node_modules/entities $T/node_modules/
fi
mkdir -p "$(dirname "$OUT")"
record_env "${OUT%.csv}.env-$(date +%Y%m%d-%H%M%S).json"
echo "round,suite,dom,mode,ms,passed,failed,tests,status" > "$OUT"
for round in $(seq 1 $ROUNDS); do
  for suite in $SUITES; do
    W=$WARPDOM_DIR; [ $suite = emoji-picker-element ] && W=$T
    for dom in jsdom happy-dom warpdom; do
      for mode in isolated noisolate fast; do
        args=(--repos-dir $REPOS_DIR --only $suite --environment $dom --warpdom $W --out $ENV_DIR/h2h --max-workers 2 --timeout 4)
        [ $mode = noisolate ] && args+=(--extra-args "--no-isolate")
        if [ $mode = fast ]; then
          case $dom in
            jsdom) setup="$(pkgdir $suite)/.dom-fresh/fresh-jsdom.mjs";;
            happy-dom) setup="$(pkgdir $suite)/.dom-fresh/fresh-happy-dom.mjs";;
            warpdom) setup="$W/src/vitest-reset.js";;
          esac
          args+=(--extra-args "--no-isolate" --first-setup "$setup")
        fi
        nodex scripts/trace-corpus.mjs "${args[@]}" >/dev/null 2>&1
        pkill -f "$(pkgdir $suite)/node_modules" 2>/dev/null
        node -e "const p=require(require('path').resolve('$ENV_DIR/h2h/status.json')).projects['$suite'].packages[0];console.log(['$round','$suite','$dom','$mode',p.run?.ms??'',p.run?.passed??'',p.run?.failed??'',p.run?.tests??'',p.status].join(','))" >> "$OUT"
        cp -f $ENV_DIR/h2h/tmp/$suite/*.$dom.json $S/h2h-$round-$suite-$dom-$mode.json 2>/dev/null
      done
    done
  done
  echo "round $round done"
done
