/**
 * Hikari Native v0 bundle root.
 *
 * The bundle registers no behavior of its own. Its three responsibilities
 * live in the subpath plugins declared by `cordis.patch.yml`:
 *
 * - `hikari-native-v0/perception` observes the real foreground window.
 * - `hikari-native-v0/world` keeps the minimal world state and decides
 *   whether a change is worth reasoning about.
 * - `hikari-native-v0/activation` wakes the configured DSH agent.
 */
export const name = 'hikari-native-v0'

export function apply() {
  // Intentionally empty: the bundle root is only a mount point.
}
