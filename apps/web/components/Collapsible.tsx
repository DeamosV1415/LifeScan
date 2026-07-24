"use client";

import { useState, type ReactNode } from "react";

/**
 * A card with a header that expands/collapses its body with a smooth height
 * transition. Used for every trace/log surface (agent trace, break-glass trace,
 * seal progress) so a long stream of steps doesn't dominate the screen.
 *
 * The height animation uses the grid-template-rows 0fr↔1fr technique, which
 * animates to content height without measuring it in JS.
 */
export function Collapsible({
  title,
  meta,
  live,
  accent,
  defaultOpen = true,
  children,
}: {
  title: string;
  /** Right-aligned adornment in the header — a count, a chip, etc. */
  meta?: ReactNode;
  /** Show a pulsing dot to signal an in-progress stream. */
  live?: boolean;
  /** CSS colour for the title text. */
  accent?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--field)_70%,transparent)]"
      >
        <span className="flex min-w-0 items-center gap-2">
          {live && <span className="size-1.5 shrink-0 rounded-full bg-vital live-dot" />}
          <span className="eyebrow truncate" style={accent ? { color: accent } : undefined}>
            {title}
          </span>
          {meta}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`size-4 shrink-0 text-faint transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
