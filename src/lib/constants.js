/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
export const ROW_HEIGHT = 36; // px, fixed so SVG link math stays simple
export const GUTTER_WIDTH = 90; // px, the channel where connection lines are drawn
export const DEFAULT_LIMIT = 2000;
export const OVERSCAN = 8; // extra rows rendered above/below the viewport

// How many older commits a single "load more" / backfill request pulls in. Kept
// modest so paging stays snappy instead of re-reading the whole history.
export const PAGE_BATCH = 500;
// Default scan range for the AUTOMATIC cross-repo backfill: how many of the
// oldest loaded commits are watched for unmatched ("unique") rows, and the
// per-head ceiling on how many commits the backfill may auto-load to close the
// gap. User-overridable in Settings; 0 turns auto-fill off entirely.
export const DEFAULT_AUTOFILL = 100;
