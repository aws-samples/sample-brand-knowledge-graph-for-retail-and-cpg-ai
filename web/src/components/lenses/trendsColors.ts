// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The map's cloud colors; the rest are gray. Six come from the color-blind-safe Okabe–Ito palette,
 * then CARTO Bold's purple and green and Tableau 10's brown and yellow. No two entries share a hue:
 * the brown and yellow replaced CARTO Bold's blue and teal, which repeated two Okabe–Ito hues.
 */
const GROUP_COLORS = ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00', '#7f3c8d', '#9c755f', '#edc948', '#80ba5a'];
/** How many clouds get a colour of their own: the largest ones (cloud 0 is the largest). */
export const COLORED_CLOUDS = GROUP_COLORS.length;
export const groupColor = (g: number) => GROUP_COLORS[g] ?? '#9aa5b1';
