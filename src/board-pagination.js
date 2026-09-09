export const HOME_LIMIT = 5;
export const ARCHIVE_PAGE_SIZE = 10;

function cleanStatus(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(entry) {
  const value = entry?.createdAt || entry?.timestamp || entry?.publishedAt || 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortBoardEntries(entries) {
  return [...entries].sort((a, b) => timestamp(b) - timestamp(a));
}

export function boardStatuses(entries) {
  return [...new Set(entries.map((entry) => cleanStatus(entry?.status)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

export function parsePage(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? Number.parseInt(text, 10) : 1;
}

export function selectHomeEntries(entries) {
  return sortBoardEntries(entries).slice(0, HOME_LIMIT);
}

export function selectArchivePage(entries, { page = 1, status = '' } = {}) {
  const sorted = sortBoardEntries(entries);
  const statuses = boardStatuses(sorted);
  const requestedStatus = cleanStatus(status);
  const selectedStatus = statuses.includes(requestedStatus) ? requestedStatus : '';
  const filtered = selectedStatus
    ? sorted.filter((entry) => cleanStatus(entry?.status) === selectedStatus)
    : sorted;
  const pageCount = Math.max(1, Math.ceil(filtered.length / ARCHIVE_PAGE_SIZE));
  const currentPage = Math.min(Math.max(parsePage(page), 1), pageCount);
  const start = (currentPage - 1) * ARCHIVE_PAGE_SIZE;

  return {
    entries: filtered.slice(start, start + ARCHIVE_PAGE_SIZE),
    page: currentPage,
    pageCount,
    status: selectedStatus,
    statuses,
    filteredCount: filtered.length,
    totalCount: sorted.length,
  };
}

export function archiveHref(page, status = '') {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (cleanStatus(status)) params.set('status', cleanStatus(status));
  const query = params.toString();
  return `/board/${query ? `?${query}` : ''}`;
}
