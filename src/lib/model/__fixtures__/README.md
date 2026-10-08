# Oracle fixtures

`oracle-derived.json` and `oracle-metrics.json` were produced by the independent concept/1 tools (the plain JavaScript
deriver and metrics of the concept stage) from the concept floor plan, which is kept as `oracle-house.json` (a valid
house/1 model with neutral texts). `oracle.test.ts` derives that plan with the TypeScript kernel and compares the result
with them, so re-planning `model/house.json` never touches the oracle. Do not regenerate these files from the kernel:
they exist to catch regressions of the kernel itself. If the schema gains a required field, add it to `oracle-house.json`
without changing its geometry.

Known differences, all documented in the tests:

* `name` of rooms is bilingual in the kernel (`{cs, en}`), a string in the oracle.
* Roof area by direction, `roofSouthArea` and `volume` come from a 2.5 cm sampling grid in the oracle; the kernel
  integrates exactly over the planar roof faces, so they agree to about 0.2 %.
