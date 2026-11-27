// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Whether the user has asked the operating system for less motion (`prefers-reduced-motion: reduce`).
 * The stylesheet stops its own animations under that media query; the force-directed graphs, which
 * animate from JavaScript, read this to lay out in one step instead of settling over seconds. False
 * where there is no window (tests).
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
