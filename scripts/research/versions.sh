#!/usr/bin/env bash
# Version dependence without warpdom (warpdom docs/research/revision-plan.md
# item 9): a project's suite on jsdom only, on its own jsdom and on other
# jsdom versions forced through the package manager's overrides.
#
#   [VARIANTS="jsdom@20.0.3 ..."] scripts/research/versions.sh <out dir> <project...>
#
# Per project, in this order (harness --environment jsdom, 2 workers):
#   own-a, own-b  the project's own jsdom, twice: tests (and files) whose
#                 status differs between these two runs are flaky and left
#                 out of every count (versions-report.cjs)
#   jsdom-<v>...  each of VARIANTS (default jsdom@20.0.3 jsdom@26.1.0
#                 jsdom@30.1.2; svelte also cssstyle@4.1.0 cssstyle@4.6.0,
#                 its own jsdom with each cssstyle): the override is written
#                 (versions.cjs apply), the project installed without a frozen
#                 lockfile, the suite run, and package.json, the workspace
#                 file and the lockfile restored from a copy. Packages
#                 without a jsdom of their own (the harness links one in)
#                 get <name>@<v> installed into a directory of its own
#                 (DOM_TRACE_DOM_MODULES).
# At the end the files are restored once more and the project's own
# install command (frozen) run, so the checkout is as before.
#
# A variant whose install or run fails is NA with the reason (data: e.g.
# an old Jest that cannot load a new jsdom). Output per project in
# <out dir>/<project>/<variant>/: map.json (statuses.cjs map with
# failure messages), meta.json ({ variant, status, reason, seconds,
# resolved: per package the jsdom/cssstyle its runner resolves, linked:
# the version linked into packages without one }), harness.log,
# install.log. Summarize with versions-report.cjs <out dir>.
#
# TIMEOUT_MIN (default 45) per package run.
[ $# -ge 2 ] || { echo "usage: [VARIANTS=...] versions.sh <out dir> <project...>" >&2; exit 2; }
case $1 in /*) OUT=$1;; *) OUT=$PWD/$1;; esac; shift
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
mkdir -p "$OUT"
record_env "$OUT/env-$(date +%Y%m%d-%H%M%S).json"
V=$RESEARCH_DIR/versions.cjs
CORPUS=$(cd "$(dirname "$CORPUS")" && pwd)/$(basename "$CORPUS")

# meta <file> <variant> <status> <reason> <seconds> <resolved json> <linked>
meta() {
  nodex -e 'const [f, variant, status, reason, seconds, resolved, linked] = process.argv.slice(1);
    require("fs").writeFileSync(f, JSON.stringify({ variant, status, reason: reason || null, seconds: seconds === "" ? null : +seconds,
      resolved: JSON.parse(resolved || "{}"), linked: linked || null }, null, 2));' "$@"
}

for p in "$@"; do
  dir=$(nodex "$V" dir "$CORPUS" "$REPOS_DIR" "$p") || continue
  variants=${VARIANTS:-"jsdom@20.0.3 jsdom@26.1.0 jsdom@30.1.2"}
  [ -z "$VARIANTS" ] && [ "$p" = svelte ] && variants="$variants cssstyle@4.1.0 cssstyle@4.6.0"
  backup=$WORK_DIR/versions-backup/$p
  rm -rf "$backup"; mkdir -p "$backup"
  built=""

  # run_variant <variant>: one harness run on jsdom, archived.
  run_variant() {
    local name=$1 d=$OUT/$p/$1 hout=$ENV_DIR/versions-$1 build="--no-build" log secs
    mkdir -p "$d"; rm -rf "$hout"
    [ -z "$built" ] && build="" && built=1
    log=$(harness --only "$p" --environment jsdom --out "$hout" --max-workers 2 --timeout "${TIMEOUT_MIN:-45}" $build 2>&1)
    echo "$log" > "$d/harness.log"
    cp "$hout/logs/$p"/*.log "$d/" 2>/dev/null
    secs=$(echo "$log" | complete_seconds)
    status_map_msg "$hout/tmp/$p" "$d/map.json"
    local status=ok reason=""
    if [ -z "$secs" ]; then
      status=NA
      reason=$(echo "$log" | grep -E "^\s+(failed)\s|^  failed: " | head -3 | sed 's/^ *//' | paste -sd'; ' -)
      [ -n "$reason" ] || reason="no results"
    fi
    meta "$d/meta.json" "$name" "$status" "$reason" "$secs" "$(nodex "$V" resolved "$CORPUS" "$dir" "$p")" "${LINKED:-}"
    echo "VERSIONS $p $name: $status ${secs:+${secs}s }${reason:+($reason)}"
  }
  status_map_msg() { nodex "$RESEARCH_DIR/statuses.cjs" map "$1" jsdom "$2" --root "$dir" --messages; }

  echo "VERSIONS $p: $dir"
  LINKED="dom-api-tracer jsdom $(nodex -p 'require("./node_modules/jsdom/package.json").version')" run_variant own-a
  # The first run installed (and built) the project; back up its files now.
  for f in $(nodex "$V" files "$dir"); do cp "$dir/$f" "$backup/$f"; done
  restore() { for f in $(ls "$backup"); do cp "$backup/$f" "$dir/$f"; done; }
  LINKED="dom-api-tracer jsdom $(nodex -p 'require("./node_modules/jsdom/package.json").version')" run_variant own-b
  install_cmd=$(nodex "$V" install "$CORPUS" "$dir" "$p")
  for v in $variants; do
    name=${v%@*}-${v#*@}; d=$OUT/$p/$name; mkdir -p "$d"
    if ! nodex "$V" apply "$dir" "${v%@*}" "${v#*@}" > "$d/install.log" 2>&1; then
      meta "$d/meta.json" "$name" NA "override not written: $(tail -1 "$d/install.log")" "" "{}" ""
      restore; continue
    fi
    echo "VERSIONS $p $name: installing ($install_cmd)"
    if ! (cd "$dir" && CI=1 bash -c "$install_cmd") > "$d/install.log" 2>&1; then
      meta "$d/meta.json" "$name" NA "install failed: $(grep -iE 'err|error' "$d/install.log" | head -2 | paste -sd' ' - | cut -c1-300)" "" "{}" ""
      echo "VERSIONS $p $name: NA (install failed)"
      restore; continue
    fi
    if [ "${v%@*}" = jsdom ]; then
      # A copy of jsdom@<version> for packages that have no jsdom of their own.
      mods=$WORK_DIR/dom-modules/$name
      [ -f "$mods/node_modules/jsdom/package.json" ] || { mkdir -p "$mods" && (cd "$mods" && echo '{}' > package.json && npm install --no-audit --no-fund "$v" > install.log 2>&1); }
      DOM_TRACE_DOM_MODULES=$mods/node_modules LINKED="$v" run_variant "$name"
    else
      LINKED="dom-api-tracer jsdom (no $v)" run_variant "$name"
    fi
    restore
  done
  # The checkout as before: files restored above, the project's own install.
  restore
  own_install=$(nodex "$V" install "$CORPUS" "$dir" "$p" --frozen)
  (cd "$dir" && CI=1 bash -c "$own_install") > "$OUT/$p/restore-install.log" 2>&1 \
    && echo "VERSIONS $p: restored ($own_install)" || echo "VERSIONS $p: restoring install failed (see $OUT/$p/restore-install.log)"
  # The jsdom each runner resolves now must be own-a's again.
  nodex "$V" resolved "$CORPUS" "$dir" "$p" > "$OUT/$p/restored.json"
  nodex -e 'const f = require("fs"), [a, b] = process.argv.slice(1).map((x) => JSON.parse(f.readFileSync(x, "utf8")));
    const same = JSON.stringify(a.resolved) === JSON.stringify(b);
    console.log(same ? "restored: as own-a" : "restored: DIFFERS from own-a " + JSON.stringify(b));' "$OUT/$p/own-a/meta.json" "$OUT/$p/restored.json" | sed "s/^/VERSIONS $p /"
done
echo "VERSIONS done"
