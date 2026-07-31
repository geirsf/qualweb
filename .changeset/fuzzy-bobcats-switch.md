---
"@qualweb/cui-checks": patch
---

Align `unitsLocale` helper tests with the current tri-state behavior of `recognizeUnitByLocale`.

- Keep `true` for recognized units in the target locale.
- Keep `false` for units recognized in a different locale.
- Expect `null` when no unit is recognized in the input text.

This matches the helper and check semantics introduced after the original tests were added, where no recognized unit maps to an inapplicable outcome instead of a failure.
