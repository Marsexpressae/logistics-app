// The database sends at most 1,000 rows per request. When a list reaches that, older rows are missing without any error,
// so say so. See ADR-0007 in the Mars ERP notes.
export const ROW_LIMIT = 1000;

export default function RowLimitNotice({ count, what, effect }: { count: number | undefined; what: string; effect: string }) {
  if (count === undefined || count < ROW_LIMIT) return null;
  return (
    <p role="alert" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      Showing only the newest {ROW_LIMIT.toLocaleString()} {what}. Older ones are not included, so {effect}
    </p>
  );
}
