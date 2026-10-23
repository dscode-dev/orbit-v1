import { assignmentsApi, type Assignment, type Role } from '@erp/api';

/** Every page is needed so older scheduled operations remain in the calendar. */
export async function loadOperatorAgenda(
  role: Role | null,
  signal: AbortSignal,
): Promise<Assignment[]> {
  const list = role === 'OWNER' ? assignmentsApi.listOwnerAgenda : assignmentsApi.listMyAssignments;
  const items: Assignment[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    if (signal.aborted) throw new DOMException('Consulta cancelada', 'AbortError');
    const response = await list({ page, limit: 100, signal });
    items.push(...response.items);
    totalPages = response.pagination.totalPages;
    page += 1;
  } while (page <= totalPages);
  return items;
}
