---
"@qualweb/qw-page": patch
---

Fix CommonJS test bootstrap in `packages/qw-page/test/page.spec.ts` by removing `import.meta` and `createRequire` usage.

The test runs via `ts-node/register` in CommonJS mode, where `require` and `__dirname` are already available. This avoids `TS1470` and `TS2441` workflow failures.
