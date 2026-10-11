"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { inputClass } from "@/components/ui/form";
import type { SortColumn } from "@/lib/sort";
import type { SortState } from "@/lib/use-sort";

/**
 * A table heading you can click to sort by that column. The sort direction is announced to screen readers (aria-sort),
 * the whole heading is a 44px tap target, and an arrow shows which column is sorted and which way.
 */
export function SortableTh<T>({ column, sort, align = "left", className = "" }: { column: SortColumn<T>; sort: SortState<T>; align?: "left" | "right"; className?: string }) {
  const active = sort.activeKey === column.key;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={!active ? "none" : sort.dir === "asc" ? "ascending" : "descending"} className={`px-2 py-0 ${align === "right" ? "text-right" : ""} ${className}`}>
      <button
        type="button"
        onClick={() => sort.toggle(column.key)}
        title={column.hint}
        className={`inline-flex min-h-11 items-center gap-1 rounded px-2 font-semibold uppercase ${align === "right" ? "flex-row-reverse" : ""} ${active ? "text-slate-900" : "text-slate-500 hover:text-slate-900"}`}
      >
        <span>{column.label}</span>
        <Icon className={`h-4 w-4 shrink-0 ${active ? "" : "opacity-50"}`} aria-hidden="true" />
      </button>
    </th>
  );
}

const WORDS = {
  text: ["A to Z", "Z to A"],
  number: ["Smallest first", "Biggest first"],
  date: ["Oldest first", "Newest first"],
} as const;

/** The same sort as the headings, for phones, where lists are cards and there are no headings. */
export function SortSelect<T>({ sort, className = "" }: { sort: SortState<T>; className?: string }) {
  return (
    <select value={sort.value} onChange={(e) => sort.choose(e.target.value)} aria-label="Sort by" className={`${inputClass} w-auto md:hidden ${className}`}>
      <option value="">Sort: normal order</option>
      {sort.columns.map((c) => {
        const [asc, desc] = c.words ?? WORDS[c.kind ?? "text"];
        return [
          <option key={`${c.key}:asc`} value={`${c.key}:asc`}>
            {c.label}: {asc}
          </option>,
          <option key={`${c.key}:desc`} value={`${c.key}:desc`}>
            {c.label}: {desc}
          </option>,
        ];
      })}
    </select>
  );
}
