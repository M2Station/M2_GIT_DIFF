/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React from 'react';

// Circled "VS" versus badge used on the Compare pill, the compare-basket "go"
// button, and the side-by-side compare window header: a thin ring enclosing a
// bold V and a blocky, angular varsity-style S. Drawn entirely in
// `currentColor` so it inherits the surrounding text color and adapts to every
// theme (accent pill, basket button, muted popup header alike).
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
      {/* enclosing ring */}
      <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="3" />
      {/* bold V */}
      <path d="M8.5 14.5 L13 14.5 L16.5 27 L20 14.5 L24.5 14.5 L18.7 33.5 L14.3 33.5 Z" fill="currentColor" />
      {/* blocky angular S */}
      <path
        d="M39 15 L29 15 L26.5 17.5 L26.5 23 L29 25.5 L35 25.5 L35 29.5 L26.5 29.5 L26.5 33.5 L36.5 33.5 L39 31 L39 25 L36.5 22.5 L30.5 22.5 L30.5 19 L39 19 Z"
        fill="currentColor"
      />
    </svg>
  );
}
