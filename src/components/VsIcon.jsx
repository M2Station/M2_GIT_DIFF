/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React from 'react';

// Stylized "VS" lightning mark used on the Compare pill and the compare
// window header. Drawn in a single `currentColor` so it inherits the
// surrounding text color and adapts to every theme. A bold V (left) and S
// (right) flank a diagonal lightning bolt whose pointed ends extend above and
// below the letters — the classic "versus" look.
export default function VsIcon({ className, title }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {/* V (left) */}
      <path d="M2.5 9.5 L14 38 L25.5 9.5 L19.5 9.5 L14 24 L8.5 9.5 Z" fill="currentColor" />
      {/* lightning bolt divider, upper-right to lower-left */}
      <path d="M34 0 L23 22 L28.5 22 L16 48 L27 24 L21.5 24 Z" fill="currentColor" />
      {/* S (right) */}
      <path
        d="M45.5 15.5 C45.5 10.5 38.5 9.5 35 12 C31.5 14.5 32 19 37 21.5 C42 24 43 28.5 39.5 31.5 C36 34.5 30 33.5 29 29"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
