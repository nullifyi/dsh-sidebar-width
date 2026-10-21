# Recording-driven layout repair

**Goal:** finish the recorded resize workflow without crushing unrelated panes, stretching empty cards, or losing workspace items.

**Architecture:** retain the host DOM and existing reversible style ownership. Treat a drag as a local resize transaction: its maximum comes from rendered sibling sizes, not their theoretical minima. Fit a whole atomic card's content to its requested height, in both directions and with bounded magnification; keep workspace overflow scrollable.

**Scope:** `client.js`, real Chromium geometry tests, README and release metadata. No host archive, other plugin, credential, or profile edits. The user requested inline execution without further choices.

## Execution

- [x] Add recording regressions in `tests/sidebar.spec.js`: grow footer past available space and preserve brand/new/nav dimensions; enlarge a card and verify rendered text grows; repeat reversal/reset; scroll a main pane whose children cannot flex-shrink.
- [x] Run the new tests against 0.6.22 and retain the observed failures.
- [x] In `client.js`, derive pane/row drag ceilings from actual sibling allocations. Preserve sibling allocations across release. Cap whole-card magnification and fit text without vertical/horizontal loss; clamp oversized old card requests during rendering rather than deleting user state.
- [x] Enable main-pane scrolling without replacing a host's existing nested scrollers. Verify wheel reachability of the last item.
- [x] Run all Edge/Chrome tests, then independent read-only review and recording-shaped repeated-gesture tests. Inspect compact/expanded screenshots.
- [x] Update version/docs, commit and push code plus market index; verify remote SHA and clean tree. Report fixture validation separately from real-host acceptance.

## Evidence

- Initial recording regressions failed on 0.6.22: brand 40→18px after an extreme footer gesture; card text stayed 20px when enlarged; last workspace item bottom 1303.59px exceeded main bottom 327px.
- Further old-state regression reproduced sibling rebound (brand 22.63→25.91px); startup regression confirmed `foot:2500` also crushed the brand to 22.63px. Both now preserve brand/new/nav at 40/38/220px with `nav:220`.
- Card fitting runs after ancestor grid placement. Magnification is capped at 2× and by intrinsic wrapping; when no scale exactly fills a requested height, spare space stays outside the bordered card. Exact pointer-height growth is intentionally not promised past a width/wrap limit.
- Explicit gestures adopt rendered sibling allocations, but viewport resize alone does not modify saved requests. Host DOM is not reparented; reversible style ownership is retained.
- Edge: 37/37 passed. Chrome: 37/37 passed. Syntax checks and version consistency passed for 0.6.23. Independent read-only Edge review found no unresolved Critical/Important issues.
- These are real-browser fixture checks, not a claim that the running DSH host was restarted or accepted. No host archive, profile, credential or other plugin was changed.
- Release 0.6.23: code `bc3a9dd15fbc3289f32734e49729a6168e5f296b`; market entry `5ea9251`. Both pushed to `origin/main`; index source pins the code SHA. Remote branch SHA and clean working tree were checked after publishing.
