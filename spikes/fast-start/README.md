# Spike: fast-start test DOM

Can a test DOM with jsdom's shape (219 interfaces, 3,710 members) start much
faster than jsdom and happy-dom, while keeping per-file isolation (each test
file's window has its own prototypes, so patches cannot leak)?

```sh
node extract-shapes.cjs   # jsdom's interfaces -> shapes.json
node generate.cjs         # -> fastdom.cjs (core behaviour real, other members generated stand-ins)
node bench-baseline.cjs   # window creation: jsdom, happy-dom
node bench-fastdom.cjs    # window creation + isolation and core checks
cd vitest && SPIKE_ENV=jsdom ../../../node_modules/.bin/vitest run --maxWorkers=2
#            SPIKE_ENV=happy-dom | ./fastdom-environment.mjs | node (floor)
```

Results and conclusions: `../../docs/fast-start-spike.md`.
