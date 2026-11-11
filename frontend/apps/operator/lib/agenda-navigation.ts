/** Calendar context travels in the URL so returning/reloading keeps the selected day. */
type SearchParams = Pick<URLSearchParams, "get">;

function parseDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function agendaSelection(params: SearchParams, today: Date) {
  const selected = parseDate(params.get("date")) ?? today;
  const month = params.get("month");
  const cursor = month && /^\d{4}-\d{2}$/.test(month) ? parseDate(`${month}-01`) : null;
  return { selected, cursor: cursor ?? new Date(selected.getFullYear(), selected.getMonth(), 1) };
}

function contextQuery(selected: Date, cursor: Date): URLSearchParams {
  return new URLSearchParams({ date: dateKey(selected), month: dateKey(cursor).slice(0, 7) });
}

export function agendaHref(selected: Date, cursor: Date): string {
  return `/operator/agenda?${contextQuery(selected, cursor)}`;
}

export function agendaDetailHref(id: string, selected: Date, cursor: Date): string {
  const query = contextQuery(selected, cursor);
  query.set("from", "agenda");
  return `/operator/services/${encodeURIComponent(id)}?${query}`;
}

/** Only rebuild our own calendar route; never accept an arbitrary return URL. */
export function agendaReturnHref(params: SearchParams): string | null {
  if (params.get("from") !== "agenda") return null;
  const { selected, cursor } = agendaSelection(params, new Date());
  return agendaHref(selected, cursor);
}
