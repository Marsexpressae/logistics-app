"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { firstDirOf, sortRows, type SortColumn, type SortDir } from "@/lib/sort";

/**
 * The sort of a list, kept in the web address (?sort=pickup&dir=desc). A refresh keeps it, and the link can be shared.
 * Nothing is remembered between visits: with no sort in the address a list starts in its normal order.
 *
 * Click a heading: first click sorts one way, the second click the other way, the third goes back to the normal order.
 * The page must sit inside a <Suspense> boundary (it reads the address).
 *
 * - `prefix` lets a page hold two sorts at once (for example "c" gives ?csort=...&cdir=...).
 * - `onChange` runs after a person changes the sort (for example to go back to page 1 of a list the database sorts).
 * - For lists the database sorts, pass `activeKey` and `dir` to the query, and do not call `sorted`.
 */
export function useSort<T>(columns: SortColumn<T>[], options: { prefix?: string; onChange?: () => void } = {}) {
  const sortParam = `${options.prefix ?? ""}sort`;
  const dirParam = `${options.prefix ?? ""}dir`;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const active = columns.find((c) => c.key === params.get(sortParam));
  const dir: SortDir = params.get(dirParam) === "desc" ? "desc" : "asc";

  function write(key: string | null, nextDir?: SortDir) {
    const next = new URLSearchParams(params.toString());
    if (key) {
      next.set(sortParam, key);
      next.set(dirParam, nextDir ?? "asc");
    } else {
      next.delete(sortParam);
      next.delete(dirParam);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    options.onChange?.();
  }

  /** A click on a column heading. */
  function toggle(key: string) {
    const column = columns.find((c) => c.key === key);
    if (!column) return;
    const first = firstDirOf(column);
    if (active?.key !== key) return write(key, first);
    if (dir === first) return write(key, first === "asc" ? "desc" : "asc");
    write(null); // third click: back to the normal order
  }

  return {
    columns,
    activeKey: active?.key ?? null,
    dir,
    toggle,
    /** For the phone dropdown: "pickup:desc", or "" for the normal order. */
    value: active ? `${active.key}:${dir}` : "",
    choose(value: string) {
      const [key, d] = value.split(":");
      write(key || null, d === "desc" ? "desc" : "asc");
    },
    sorted: (rows: T[]) => sortRows(rows, active, dir),
  };
}

export type SortState<T> = ReturnType<typeof useSort<T>>;
