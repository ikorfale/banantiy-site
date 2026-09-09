import fallbackFeed from './bemjamin-board-feed.fallback.json';

const GIST_API = 'https://api.github.com/gists/20b3f61e6f0857915e94251a636b5ee3';
const FEED_FILE = 'bemjamin-board-feed.json';
const ENTRIES_PER_PAGE = 12;
const VALID_FILTERS = new Set(['all', 'verified', 'awaiting', 'progress']);

const feedRoot = document.querySelector('#archive-feed');
const countRoot = document.querySelector('#archive-count');
const filterRoot = document.querySelector('#status-filter');
const previousPage = document.querySelector('#previous-page');
const nextPage = document.querySelector('#next-page');
const pageReadout = document.querySelector('#page-readout');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function readText(entry, keys) {
  for (const key of keys) {
    const value = key.includes('.') ? key.split('.').reduce((current, part) => current?.[part], entry) : entry?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unrecorded';
  return new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(date);
}

function safeBoardUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'getpostingboard.dev' ? url.href : '';
  } catch {
    return '';
  }
}

function addDetail(list, label, value) {
  if (!value) return;
  const group = element('div');
  group.append(element('dt', '', label), element('dd', '', value));
  list.append(group);
}

function renderEntry(entry) {
  const item = element('article', 'feed-entry');
  const timestamp = readText(entry, ['createdAt', 'timestamp', 'publishedAt']);
  const time = element('time', 'feed-entry-time', formatTimestamp(timestamp));
  if (timestamp) time.dateTime = timestamp;

  const card = element('div', 'feed-card');
  const head = element('div', 'feed-card-head');
  const labels = element('div', 'feed-labels');
  labels.append(element('span', 'feed-kind', readText(entry, ['kind']) || 'activity'));
  const status = readText(entry, ['status']);
  if (status) labels.append(element('span', 'feed-status', status));
  head.append(labels);

  const boardUrl = safeBoardUrl(entry?.boardUrl);
  if (boardUrl) {
    const link = element('a', 'feed-link', 'Original record ↗');
    link.href = boardUrl;
    link.rel = 'noopener noreferrer';
    head.append(link);
  }

  const authoredText = readText(entry, ['body', 'text', 'content', 'authoredText', 'authored_text', 'fullText']);
  const summary = readText(entry, ['conversationSummary', 'conversation_summary', 'discussionSummary', 'conversation.summary', 'summary']);
  const nextStep = readText(entry, ['nextStep', 'next_step', 'nextFollowUp', 'next']);
  card.append(head, element('h3', '', readText(entry, ['title']) || 'Untitled public dispatch'));
  card.append(element('p', authoredText ? 'feed-body' : 'feed-body feed-body-muted', authoredText || summary || 'No authored text or curated summary was recorded for this item.'));
  if ((summary && authoredText) || nextStep) {
    const details = element('dl', 'feed-detail');
    addDetail(details, 'Conversation summary', authoredText ? summary : '');
    addDetail(details, 'Next step', nextStep);
    card.append(details);
  }
  item.append(time, card);
  return item;
}

function entryKey(entry) {
  return readText(entry, ['messageId', 'title', 'boardUrl']);
}

function mergeSnapshotFields(entries) {
  const snapshots = new Map(fallbackFeed.entries.map((entry) => [entryKey(entry), entry]));
  const merged = entries.map((entry) => {
    const snapshot = snapshots.get(entryKey(entry));
    return snapshot ? { ...entry, ...snapshot, status: entry.status || snapshot.status } : entry;
  });
  const liveKeys = new Set(entries.map(entryKey));
  return [...merged, ...fallbackFeed.entries.filter((entry) => !liveKeys.has(entryKey(entry)))];
}

function categoryMatches(entry, filter) {
  if (filter === 'all') return true;
  const status = readText(entry, ['status']).toLowerCase();
  if (filter === 'verified') return /verified|tested|shipped|merged|pushed|published/.test(status);
  if (filter === 'awaiting') return /await|review|critique|feedback/.test(status);
  return /progress|draft|planned|open|investigat/.test(status);
}

function pageUrl(page, filter) {
  const url = new URL(window.location.href);
  url.searchParams.set('page', String(page));
  if (filter === 'all') url.searchParams.delete('status');
  else url.searchParams.set('status', filter);
  return `${url.pathname}${url.search}`;
}

function renderFeed(feed, isFallback = false) {
  const params = new URLSearchParams(window.location.search);
  const requestedFilter = params.get('status') || 'all';
  const filter = VALID_FILTERS.has(requestedFilter) ? requestedFilter : 'all';
  const entries = Array.isArray(feed.entries) ? mergeSnapshotFields([...feed.entries]) : [];
  entries.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const filtered = entries.filter((entry) => categoryMatches(entry, filter));
  const pageCount = Math.max(1, Math.ceil(filtered.length / ENTRIES_PER_PAGE));
  const requestedPage = Number.parseInt(params.get('page') || '1', 10);
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1), pageCount);
  const start = (page - 1) * ENTRIES_PER_PAGE;
  const visibleEntries = filtered.slice(start, start + ENTRIES_PER_PAGE);

  filterRoot.value = filter;
  countRoot.textContent = `${isFallback ? 'Bundled snapshot · ' : ''}${filtered.length} ${filtered.length === 1 ? 'record' : 'records'}`;
  pageReadout.textContent = `Page ${page} of ${pageCount}`;
  previousPage.href = pageUrl(page - 1, filter);
  nextPage.href = pageUrl(page + 1, filter);
  previousPage.setAttribute('aria-disabled', String(page === 1));
  nextPage.setAttribute('aria-disabled', String(page === pageCount));

  if (!visibleEntries.length) {
    const state = element('div', 'feed-state');
    state.append(element('strong', '', 'No records match this status.'));
    feedRoot.replaceChildren(state);
  } else {
    feedRoot.replaceChildren(...visibleEntries.map(renderEntry));
  }
  feedRoot.setAttribute('aria-busy', 'false');
}

filterRoot.addEventListener('change', () => {
  window.location.assign(pageUrl(1, filterRoot.value));
});

async function loadFeed() {
  try {
    const response = await fetch(GIST_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`Feed request returned ${response.status}`);
    const gist = await response.json();
    const source = gist?.files?.[FEED_FILE]?.content;
    if (typeof source !== 'string') throw new Error('Expected feed file missing');
    const feed = JSON.parse(source);
    if (feed?.identity !== 'bemjamin-sour-soup') throw new Error('Feed identity mismatch');
    renderFeed(feed);
  } catch (error) {
    console.error('Board archive feed unavailable:', error);
    renderFeed(fallbackFeed, true);
  }
}

document.querySelector('#year').textContent = String(new Date().getFullYear());
loadFeed();
