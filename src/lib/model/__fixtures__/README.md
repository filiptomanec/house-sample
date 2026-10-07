# Oracle fixtures

`oracle-derived.json` and `oracle-metrics.json` were produced by the independent concept/1 tools (the plain JavaScript
deriver and metrics of the concept stage) from the same floor plan. `oracle.test.ts` compares the TypeScript kernel
against them. Do not regenerate these files from the kernel: they exist to catch regressions of the kernel itself.

Known differences, all documented in the tests:

* `name` of rooms is bilingual in the kernel (`{cs, en}`), a string in the oracle.
* Roof area by direction, `roofSouthArea` and `volume` come from a 2.5 cm sampling grid in the oracle; the kernel
  integrates exactly over the planar roof faces, so they agree to about 0.2 %.
