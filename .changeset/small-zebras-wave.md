---
"@qualweb/counter": patch
---

Fix CommonJS test bootstrap in `counter.spec.ts` by removing `import.meta`/`createRequire` setup.

The counter test suite runs with `ts-node/register` in a CommonJS context, where `require` and `__dirname` are already available. This avoids TypeScript/CommonJS errors in CI and local test runs.
