# Mobile regression tests

Run from the repository root with Node.js 20 or newer:

```sh
npm --prefix tests ci --ignore-scripts
npm --prefix tests test
```

All records are synthetic. Tests run the existing application event handlers in
an in-memory DOM with no Supabase configuration and no external requests. The
test-only jsdom dependency is not included in the application or loaded by Pages.

Coverage includes searchable dropdowns, dynamic invoice/purchase rows, quote and
customer lookup, locked fields, keyboard/cancel/reset handling, multi-day wage
calculation and submission, receipt hints, navigation icons, and project statements.

Native dialog rendering is stubbed in these tests. Mobile visual layout, native
keyboard behavior and PDF pagination still require a real-browser/device pass.
