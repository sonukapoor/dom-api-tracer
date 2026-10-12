# Timing configurations and harness-output parsing shared by the research
# scripts (sourced by lib.sh; test-configs.cjs checks it in npm test).
# Only functions: no side effects when sourced.

# parse_config <config>: prints "<environment> <ablate> <frames> <pool>" for
# a timing-rounds.sh configuration name, one field per word, "-" for none:
#   <environment>  jsdom, happy-dom or warpdom (the harness's --environment)
#   <ablate>       WARPDOM_ABLATE: "-" unset, "''" set to the empty string,
#                  else its value
#   <frames>       1 for WARPDOM_FAST_FRAMES=1, else "-"
#   <pool>         vmThreads for <dom>-vm (Vitest only), else "-"
# Names: <dom>-<default|vm> with dom one of jsdom, happy-dom, warpdom,
# warpdomframes (WARPDOM_FAST_FRAMES=1), warpdomeager, warpdomnocache,
# warpdomlatest (warpdom ablations); and two controls for the A/A run:
#   warpdom-default-aa    warpdom-default again under another name, so the
#                         paired ratio of two identical configurations
#                         measures the noise floor
#   warpdom-ablate-unset  warpdom-default with WARPDOM_ABLATE set to the
#                         empty string (every other configuration runs with
#                         it unset or set to an ablation), so the switch's
#                         cost when no ablation is chosen shows
# Unknown names print nothing and return 1.
parse_config() {
  local cfg=$1 env ablate=- frames=- pool=-
  case "$cfg" in
    warpdom-default-aa) echo "warpdom - - -"; return 0;;
    warpdom-ablate-unset) echo "warpdom '' - -"; return 0;;
  esac
  case "${cfg##*-}" in
    default) ;;
    vm) pool=vmThreads;;
    *) return 1;;
  esac
  env=${cfg%-*}
  case "$env" in
    jsdom|happy-dom|warpdom) ;;
    warpdomframes) env=warpdom; frames=1;;
    # Ablations (warpdom's WARPDOM_ABLATE, docs/research/ablation-plan.md in warpdom).
    warpdomeager) env=warpdom; ablate=eager-interfaces;;
    warpdomnocache) env=warpdom; ablate=no-query-cache;;
    warpdomlatest) env=warpdom; ablate=latest-profile;;
    *) return 1;;
  esac
  echo "$env $ablate $frames $pool"
}

# with_ablate <ablate> <command...>: runs the command (a function too) in a
# subshell with WARPDOM_ABLATE as parse_config gives it: "-" unset (even if
# the caller has it), "''" the empty string, else that value.
with_ablate() {
  local a=$1; shift
  (
    case "$a" in
      -) unset WARPDOM_ABLATE;;
      "''") export WARPDOM_ABLATE=;;
      *) export WARPDOM_ABLATE=$a;;
    esac
    "$@"
  )
}

# Reads harness output on stdin; prints one line per package run:
# "<package dir> <ran|failed|skipped> <seconds|NA>" (the runner time the
# harness reports for that package; NA when it did not run to the end).
package_times() {
  sed -nE 's/^[[:space:]]+(ran|failed|skipped)[[:space:]]+([^[:space:]]+): (.*)$/\2 \1 \3/p' \
    | while read -r dir status rest; do
        secs=NA
        if [ "$status" = ran ]; then
          secs=$(printf '%s\n' "$rest" | grep -oE '[0-9.]+s$' | tr -d s)
          [ -n "$secs" ] || secs=NA
        fi
        echo "$dir $status $secs"
      done
}
