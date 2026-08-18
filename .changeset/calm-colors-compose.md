---
'@qualweb/act-rules': patch
'@qualweb/locale': patch
'@qualweb/qw-element': patch
'@qualweb/util': patch
---

Improve QW-ACT-R37 contrast evaluation, including exact WCAG thresholds, opacity and background compositing, transparent text and text-shadow handling, disabled content handling, and conservative handling of complex backgrounds. Centralize group-or-widget role classification in AccessibilityUtils for consistent disabled-ancestor handling.

Add contrast evaluation for rendered form-control values, placeholders, and selected options. Resolve authored placeholder styles, including specificity, opacity, active stylesheets, media queries, custom properties, cascade layers, native CSS nesting, and shadow roots. Return a warning when cross-origin styles prevent a reliable placeholder result.
