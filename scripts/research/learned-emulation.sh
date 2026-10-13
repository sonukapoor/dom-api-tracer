# Learned isolation's emulation (warpdom's fast mode, state version 2):
# the decision rule and the learning and learned runs, in one place for
# every configuration that uses them (ablation-isolation.sh's
# warpdom-learned; a jsdom variant sets LEARN_ENV=jsdom). Sourced after
# lib.sh, by a script that defines run, na, add, excludes, count, $p, $S,
# $E, $jsonl and $first.
#
#   LEARN_ENV    the DOM (default warpdom)
#   LEARN_FIRST  setup arguments for shared runs (default $first: warpdom's
#                reset as the first setup file; empty for jsdom)
#
# Missing results count as failures: a test or file without a result in a
# shared run (a hang, a crash, a stopped run) makes its file one to
# isolate (statuses.cjs isolate), and a shared run without a time (failed
# or stopped at its deadline) means isolated mode.
LENV=${LEARN_ENV:-warpdom}
LFIRST=${LEARN_FIRST-$first}

# The emulation's rules, as warpdom's src/vitest-fast-cli.js (state
# version 2): split must beat isolated by 5% and at least 0.5 s (beats);
# a run without isolation is stopped at 1.25 x isolated + 10 s when
# learning and 1.5 x + 30 s later (dl_min: the harness's --timeout in
# minutes); a split run no faster than the learned isolated time switches
# to isolated (keeps).
dl_min() { echo "scale=3; ($1 * $2 + $3) / 60" | bc; }
beats() { echo "m = $1 * 0.05; if (m < 0.5) m = 0.5; $2 < $1 - m" | bc; }
keeps() { echo "$2 < $1" | bc; }
now() { perl -MTime::HiRes -e 'printf "%.3f\n", Time::HiRes::time()'; }
# minus <a> <b>: words of a not in b.
minus() { comm -23 <(tr ' ' '\n' <<< "$1" | grep -v '^$' | sort -u) <(tr ' ' '\n' <<< "$2" | grep -v '^$' | sort -u) | paste -sd' ' -; }
union() { tr ' ' '\n' <<< "$1 $2" | grep -v '^$' | sort -u | paste -sd' ' -; }

# learn_harness <round> <state prefix> <map dir>: the emulation of the
# learning; writes <prefix>.isolate (files run isolated: their results
# without isolation differ from isolated, or they fail there),
# <prefix>.leaky (those that pass isolated), <prefix>.mode and
# <prefix>.tiso (the isolated time).
learn_harness() {
  local r=$1 st=$2 md=$3 ti ts="" t1 t2 tsplit="" iso="" more leaky="" mode=isolated reason dl attempt n
  ti=$(run ab-learn --environment $LENV)
  [ -n "$ti" ] || na $r learning-isolated ab-learn
  status_map $E/ab-learn/tmp/$p $LENV $md/learn-isolated.json $p
  if [ -z "$ti" ]; then reason="no isolated time"
  else
    dl=$(dl_min $ti 1.25 10)
    ts=$(run ab-learn --environment $LENV --timeout $dl --extra-args "--no-isolate" $LFIRST)
    if [ -z "$ts" ]; then
      reason="the shared run failed or passed its deadline ($dl min)"; na $r learning-shared ab-learn
    else
      status_map $E/ab-learn/tmp/$p $LENV $md/learn-shared.json $p
      iso=$(statuses isolate $md/learn-shared.json $md/learn-isolated.json)
      leaky=$(statuses leaky $md/learn-shared.json $md/learn-isolated.json)
      # The split must reproduce the isolated results; files that still
      # differ join the isolated ones, once.
      for attempt in 1 2; do
        n=$(count $iso); t2=0; echo '{}' > $md/learn-split-isolated.json
        t1=$(run ab-learn --environment $LENV --timeout $dl --extra-args "--no-isolate $(excludes $iso)" $LFIRST)
        [ -n "$t1" ] && status_map $E/ab-learn/tmp/$p $LENV $md/learn-split-shared.json $p
        if [ -n "$t1" ] && [ "$n" != 0 ]; then
          t2=$(run ab-learn --environment $LENV --extra-args "--passWithNoTests $iso")
          [ -n "$t2" ] && status_map $E/ab-learn/tmp/$p $LENV $md/learn-split-isolated.json $p
        fi
        tsplit=$(add "$t1" "$t2")
        if [ -z "$tsplit" ]; then reason="a split run failed or passed its deadline"; na $r learning-split ab-learn; break; fi
        statuses merge $md/learn-split.json $md/learn-split-shared.json $md/learn-split-isolated.json
        more=$(minus "$(statuses isolate $md/learn-split.json $md/learn-isolated.json)" "$iso")
        if [ -z "$more" ]; then
          if [ "$(beats $ti $tsplit)" = 1 ]; then mode=split; reason="split beats isolated by more than the margin"
          else reason="split does not beat isolated by more than the margin"; fi
          break
        fi
        if [ $attempt = 2 ]; then reason="the split's results differ from isolated in $(count $more) more file(s)"; tsplit=""; break; fi
        iso=$(union "$iso" "$more")
      done
    fi
  fi
  echo "$iso" > $st.isolate; echo "$leaky" > $st.leaky; echo $mode > $st.mode; echo "${ti:-0}" > $st.tiso
  local total; total=$(add "$(add "$ti" "$ts")" "$tsplit")
  nodex "$RESEARCH_DIR/learning.cjs" harness "$jsonl" $r $p learn "$REPOS_DIR/$p" \
    --t_iso "${ti:-NA}" --t_sh "${ts:-NA}" --t_split "${tsplit:-NA}" --mode $mode --leaky "$leaky" --isolate "$iso" --reason "$reason" --seconds "${total:-NA}"
  echo "LEARN round $r $p (harness): $(count $iso) files to isolate ($(count $leaky) leaky); isolated ${ti:-NA}s, shared ${ts:-NA}s, split ${tsplit:-NA}s -> $mode ($reason)"
}
# learned_run <round> <map out>: one timed learned run on the kept state;
# sets secs.
learned_run() {
  local r=$1 mapout=$2
  if [ "$(cat $S/ab-method-$p)" = cli ]; then
    secs=$(run ab-run --environment warpdom --fast-cli run --fast-state $S/ab-state/$p)
    status_map $E/ab-run/tmp/$p warpdom $mapout $p
    nodex "$RESEARCH_DIR/learning.cjs" cli $E/ab-run/tmp/$p "$jsonl" $r $p run
    [ -n "$secs" ] || na $r warpdom-learned ab-run
    return
  fi
  local st=$S/ab-state-$p iso n t1 t2=0 t3=0 ti rerun nr new="" tmp=$S/ab-lr started fell
  iso=$(cat $st.isolate); n=$(count $iso); ti=$(cat $st.tiso)
  if [ "$(cat $st.mode)" = isolated ]; then
    secs=$(run ab-run --environment $LENV)
    status_map $E/ab-run/tmp/$p $LENV $mapout $p
    [ -n "$secs" ] || na $r warpdom-learned ab-run
    nodex "$RESEARCH_DIR/learning.cjs" harness "$jsonl" $r $p run "$REPOS_DIR/$p" --mode isolated --leaky "$(cat $st.leaky)" --isolate "$iso" --seconds "${secs:-NA}"
    return
  fi
  started=$(now)
  t1=$(run ab-run --environment $LENV --timeout $(dl_min $ti 1.5 30) --extra-args "--no-isolate $(excludes $iso)" $LFIRST)
  if [ -z "$t1" ]; then
    # Stopped at its deadline (or failed): an isolated run instead, and
    # isolated from now on. The time includes the stopped run's.
    fell=$(echo "$(now) - $started" | bc)
    na $r learned-shared ab-run
    t2=$(run ab-run --environment $LENV)
    status_map $E/ab-run/tmp/$p $LENV $mapout $p
    echo isolated > $st.mode
    secs=$(add "$fell" "$t2")
    nodex "$RESEARCH_DIR/learning.cjs" harness "$jsonl" $r $p run "$REPOS_DIR/$p" --mode split --mode_after isolated \
      --leaky "$(cat $st.leaky)" --isolate "$iso" --seconds "${secs:-NA}"
    echo "LEARNED round $r $p (harness): ${secs:-NA}s, the split's shared run stopped or failed: isolated run, isolated from now on"
    return
  fi
  status_map $E/ab-run/tmp/$p $LENV $tmp-fast.json $p
  echo '{}' > $tmp-iso.json; echo '{}' > $tmp-rerun.json
  if [ "$n" != 0 ]; then
    t2=$(run ab-run --environment $LENV --extra-args "--passWithNoTests $iso")
    [ -n "$t2" ] || na $r learned-isolated ab-run
    status_map $E/ab-run/tmp/$p $LENV $tmp-iso.json $p
  fi
  # Files failing without isolation run again isolated (their results
  # count) and are isolated from now on, leaky or not.
  rerun=$(statuses failing $tmp-fast.json); nr=$(count $rerun)
  if [ "$nr" != 0 ]; then
    t3=$(run ab-run --environment $LENV --extra-args "--passWithNoTests $rerun")
    [ -n "$t3" ] || na $r learned-rerun ab-run
    status_map $E/ab-run/tmp/$p $LENV $tmp-rerun.json $p
    new=$(statuses leaky $tmp-fast.json $tmp-rerun.json)
    union "$iso" "$rerun" > $st.isolate
    union "$(cat $st.leaky)" "$new" > $st.leaky
  fi
  statuses merge $mapout $tmp-fast.json $tmp-iso.json $tmp-rerun.json
  secs=$(add "$(add "$t1" "$t2")" "$t3")
  local after=split tsplit; tsplit=$(add "$t1" "$t2")
  [ "$(keeps $ti $tsplit)" = 1 ] || { after=isolated; echo isolated > $st.mode; }
  nodex "$RESEARCH_DIR/learning.cjs" harness "$jsonl" $r $p run "$REPOS_DIR/$p" --mode split --mode_after $after \
    --leaky "$(cat $st.leaky)" --isolate "$(cat $st.isolate)" --new "$new" --rerun "$rerun" --seconds "${secs:-NA}"
  echo "LEARNED round $r $p (harness): ${secs:-NA}s, $n isolated, $nr re-run, $(count $new) new leaky; split $tsplit s vs isolated $ti s -> $after"
}

