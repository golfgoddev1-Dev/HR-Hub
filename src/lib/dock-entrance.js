// Session-scoped flag for the dock entrance animation. The dock is persistent
// now, but a layout can still remount (role switch, hard reload of another
// system); the slide-down and item stagger should play only on the first dock
// mount per page load. Module state lives here so it survives component swaps.
let played = false

/** True on the first call in this page load, false for every later dock mount. */
export function takeDockEntrance() {
  if (played) return false
  played = true
  return true
}
