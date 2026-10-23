/**
 * Types for host modules this bundle `require`s at runtime.
 *
 * These specifiers are answered by the browser module loader's own seed table
 * (`apps/web`'s `staticModules`), exactly like `react` — they are NOT npm
 * dependencies and must never be declared as one, or a private copy shadows the
 * host's and the harness breaks. Declaring them here is what lets `tsc` check
 * the call sites without a `node_modules` entry to resolve.
 *
 * Keep this minimal on purpose: only the members this bundle actually calls, so
 * a host change that removes one shows up as a compile error instead of an
 * undefined at runtime.
 */
declare module "@deepseek-ai/dsh-client-ui-primitives" {
  import type * as React from "react";

  /**
   * The host's hover tooltip: a themed bubble (not the browser's `title` box)
   * carrying an optional shortcut badge. Matches the one every shipped header
   * utility uses, so a plugin entry sits visually level with them.
   */
  export const Tooltip: React.ComponentType<{
    /** Bubble text. Required by the host component; typed optional here so a missing one is a visible empty bubble, not a crash. */
    label?: React.ReactNode;
    /** Which side of the child the bubble opens on. */
    side?: "top" | "bottom" | "left" | "right";
    /** Hover dwell before showing, in ms. */
    delayMs?: number;
    /** Render into the frame's overlay so a containing block cannot clip it. */
    portal?: boolean;
    /** Keys rendered as a badge at the bubble's trailing edge. */
    shortcutKeys?: readonly string[];
    children?: React.ReactNode;
  }>;
}
