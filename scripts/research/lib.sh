# Shared setup for the shell scripts in scripts/research. Sourced, not run.
#
# Environment variables (all optional):
#   REPOS_DIR     corpus project checkouts (default ~/Projects)
#   WARPDOM_DIR   warpdom checkout (default ../warpdom next to this repo)
#   NODE_VERSION  Node used for corpus runs through nvm (default 22.23.3;
#                 the corpus needs >= 22.23.3). Without nvm, plain `node`.
#   ENV_DIR       harness output directories (default .corpus-env)
#   WORK_DIR      scratch files of the experiments (default $ENV_DIR/research-tmp)
#
# Corpus runs are heavy: run one script at a time (2 workers each).

RESEARCH_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$RESEARCH_DIR/../.." && pwd)
REPOS_DIR=${REPOS_DIR:-$HOME/Projects}
WARPDOM_DIR=${WARPDOM_DIR:-$ROOT/../warpdom}
WARPDOM_DIR=$(cd "$WARPDOM_DIR" && pwd) || { echo "warpdom not found at $WARPDOM_DIR (set WARPDOM_DIR)" >&2; exit 1; }
NODE_VERSION=${NODE_VERSION:-22.23.3}
ENV_DIR=${ENV_DIR:-.corpus-env}
WORK_DIR=${WORK_DIR:-$ENV_DIR/research-tmp}

cd "$ROOT"
mkdir -p "$WORK_DIR" && WORK_DIR=$(cd "$WORK_DIR" && pwd)

# nvm's NODE_VERSION when installed (CI runners have nvm without it, and
# set up Node themselves), else the node on PATH.
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ] && source "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null \
    && nvm ls "$NODE_VERSION" >/dev/null 2>&1; then
  nodex() { nvm exec --silent "$NODE_VERSION" node "$@"; }
else
  nodex() { node "$@"; }
  [ "$(node --version)" = "v$NODE_VERSION" ] || echo "note: using node $(node --version), not $NODE_VERSION" >&2
fi

# The corpus harness with this setup's checkouts.
harness() { nodex scripts/trace-corpus.mjs --repos-dir "$REPOS_DIR" --warpdom "$WARPDOM_DIR" "$@"; }

# Reads harness output on stdin; prints the runner time it reports, summed
# over the project's packages, in seconds.
runner_seconds() { grep -E "^\s+(ran|failed)" | grep -oE "[0-9.]+s$" | tr -d s | paste -sd+ - | bc; }

# The jsdom baseline (per-test statuses) of a project: the jsdom timing run
# if there is one, else the survey's own baseline run.
baseline_dir() {
  local base=$ENV_DIR/jsdom-time/tmp/$1
  ls "$base"/*.jsdom.json >/dev/null 2>&1 || base=$ENV_DIR/jsdom-base/$1-run/tmp/$1
  echo "$base"
}

# Writes the run's environment (commits, Node, OS, CPU, memory) to $1.
record_env() {
  nodex "$RESEARCH_DIR/record-env.mjs" --out "$1" --repos-dir "$REPOS_DIR" --warpdom "$WARPDOM_DIR" >/dev/null
  echo "environment recorded in $1"
}
