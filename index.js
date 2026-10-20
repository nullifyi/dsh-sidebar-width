/**
 * dsh-sidebar-width — Host half.
 *
 * Shape follows the official template (`cordis-plugin-development/templates/decoration/`):
 * ESM + `export function apply() {}`.
 *
 * This shape is not optional. A CommonJS `module.exports = { name }` without an
 * `apply` export leaves the row `enabled: true` but `fiberPhase: null`: the fiber
 * never instantiates, the row never enters the loader tree, client-modules never
 * scans it, the browser never calls `window.__ModuleLoader__.load`, and nothing
 * reports an error.
 *
 * All behaviour lives in the client half; this side only needs a real `apply`
 * so the row mounts.
 */

export const SETTINGS_ENTRY = 'sidebar-width'

/** No host-side behaviour: the sidebar width is a pure browser concern. */
export function apply() {}
