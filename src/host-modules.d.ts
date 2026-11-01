/**
 * Types for host modules this bundle `require`s at runtime.
 *
 * These specifiers are answered by the browser module loader's own seed table
 * (`apps/web`'s `staticModules`), exactly like `react` — they are NOT npm
 * dependencies and must never be declared as one, or a private copy shadows the
 * host's and the harness breaks. Declaring them here is what lets `tsc` check
 * the call sites without a `node_modules` entry to resolve.
 *
 * These are local declarations, not a check of the running host's exports.
 * Declare only the props used here and guard optional exports at runtime.
 */
declare module "@deepseek-ai/dsh-client-ui-primitives" {
  import type * as React from "react";

  /**
   * The host's hover tooltip: a themed bubble (not the browser's `title` box)
   * carrying an optional shortcut badge. Matches the one every shipped header
   * utility uses, so a plugin entry sits visually level with them.
   */
  export const Tooltip: React.ComponentType<{
    /** Bubble text, required by both older and newer host implementations. */
    label: string | (() => string);
    /** Which side of the child the bubble opens on. */
    side?: "top" | "bottom" | "right";
    /** Hover dwell before showing, in ms. */
    delayMs?: number;
    /** Newer hosts support portals; older hosts ignore this prop. */
    portal?: boolean;
    children: React.ReactElement;
  }>;
}
