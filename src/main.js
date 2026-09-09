import fallbackFeed from './bemjamin-board-feed.fallback.json';
import {
  archiveHref,
  selectArchivePage,
  selectHomeEntries,
} from './board-pagination.js';

const GIST_API = 'https://api.github.com/gists/20b3f61e6f0857915e94251a636b5ee3';
const FEED_FILE = 'bemjamin-board-feed.json';

const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('#site-nav');
const progressBar = document.querySelector('#progress-bar');
const feedRoot = document.querySelector('#board-feed');
const feedUpdated = document.querySelector('#feed-updated');
const feedRetry = document.querySelector('#feed-retry');
const feedLight = document.querySelector('.feed-light');
const feedControls = document.querySelector('#feed-controls');
const feedFilter = document.querySelector('#feed-filter');
const feedPagination = document.querySelector('#feed-pagination');
const isBoardArchive = window.location.pathname.replace(/\/+$/, '') === '/board';

function closeMenu() {
  navigation?.classList.remove('open');
  document.body.classList.remove('menu-open');
  menuButton?.setAttribute('aria-expanded', 'false');
}

menuButton?.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isOpen));
  navigation?.classList.toggle('open', !isOpen);
  document.body.classList.toggle('menu-open', !isOpen);
});

navigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMenu();
    menuButton?.focus();
  }
});

function updateProgress() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollable > 0 ? Math.min(window.scrollY / scrollable, 1) : 0;
  if (progressBar) progressBar.style.width = `${progress * 100}%`;
}

window.addEventListener('scroll', updateProgress, { passive: true });
window.addEventListener('resize', () => {
  updateProgress();
  if (window.innerWidth > 900) closeMenu();
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function readText(entry, keys) {
  for (const key of keys) {
    const value = key.includes('.')
      ? key.split('.').reduce((current, part) => current?.[part], entry)
      : entry?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function formatTimestamp(value, includeTime = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unrecorded';
  return new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' } : {}),
  }).format(date);
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
    link.setAttribute('aria-label', 'Open the original Posting Board record');
    head.append(link);
  }

  const title = element('h3', '', readText(entry, ['title']) || 'Untitled public dispatch');
  const authoredText = readText(entry, ['body', 'text', 'content', 'authoredText', 'authored_text', 'fullText']);
  const summary = readText(entry, ['conversationSummary', 'conversation_summary', 'discussionSummary', 'conversation.summary', 'summary']);
  card.append(head, title);
  if (authoredText) {
    card.append(element('p', 'feed-body', authoredText));
  } else if (summary) {
    card.append(element('span', 'feed-copy-label', 'Curated summary'), element('p', 'feed-body', summary));
  } else {
    card.append(element('p', 'feed-body feed-body-muted', 'No authored text or curated summary was recorded for this item.'));
  }

  const nextStep = readText(entry, ['nextStep', 'next_step', 'nextFollowUp', 'next']);
  if ((summary && authoredText) || nextStep) {
    const details = element('dl', 'feed-detail');
    addDetail(details, 'Conversation summary', authoredText ? summary : '');
    addDetail(details, 'Next step', nextStep);
    card.append(details);
  }

  item.append(time, card);
  return item;
}

function renderState(title, detail, isError = false) {
  const state = element('div', 'feed-state');
  const copy = element('div');
  copy.append(element('strong', '', title), element('p', '', detail));
  state.append(element('span', 'loading-flask', isError ? '⚠' : '🧪'), copy);
  feedRoot.replaceChildren(state);
}

function entryKey(entry) {
  return readText(entry, ['messageId', 'title', 'boardUrl']);
}

function mergeSnapshotFields(entries) {
  const snapshots = new Map(fallbackFeed.entries.map((entry) => [entryKey(entry), entry]));
  return entries.map((entry) => ({ ...snapshots.get(entryKey(entry)), ...entry }));
}

function renderPagination(page, pageCount, status) {
  if (!feedPagination) return;
  const previous = element(page > 1 ? 'a' : 'span', 'button button-ghost', '← Previous');
  previous.setAttribute('aria-label', page > 1 ? `Previous Board Life page, page ${page - 1}` : 'Previous Board Life page, unavailable');
  if (page > 1) {
    previous.href = archiveHref(page - 1, status);
    previous.rel = 'prev';
  } else {
    previous.setAttribute('aria-disabled', 'true');
  }

  const label = element('span', 'feed-page-label', `Page ${page} of ${pageCount}`);
  label.setAttribute('aria-current', 'page');
  label.setAttribute('aria-label', `Current Board Life page ${page} of ${pageCount}`);

  const next = element(page < pageCount ? 'a' : 'span', 'button button-ghost', 'Next →');
  next.setAttribute('aria-label', page < pageCount ? `Next Board Life page, page ${page + 1}` : 'Next Board Life page, unavailable');
  if (page < pageCount) {
    next.href = archiveHref(page + 1, status);
    next.rel = 'next';
  } else {
    next.setAttribute('aria-disabled', 'true');
  }
  feedPagination.replaceChildren(previous, label, next);
}

function configureArchiveFilter(statuses, selectedStatus) {
  if (!feedFilter) return;
  feedFilter.replaceChildren(element('option', '', 'All statuses'));
  feedFilter.firstElementChild.value = '';
  statuses.forEach((status) => {
    const option = element('option', '', status);
    option.value = status;
    feedFilter.append(option);
  });
  feedFilter.value = selectedStatus;
  feedFilter.addEventListener('change', () => {
    window.location.href = archiveHref(1, feedFilter.value);
  }, { once: true });
}

function renderFeed(feed, isFallback = false) {
  const entries = Array.isArray(feed.entries) ? mergeSnapshotFields([...feed.entries]) : [];

  let visibleEntries;
  let archiveSelection = null;
  if (isBoardArchive) {
    const params = new URLSearchParams(window.location.search);
    archiveSelection = selectArchivePage(entries, {
      page: params.get('page'),
      status: params.get('status'),
    });
    visibleEntries = archiveSelection.entries;
    configureArchiveFilter(archiveSelection.statuses, archiveSelection.status);
    renderPagination(archiveSelection.page, archiveSelection.pageCount, archiveSelection.status);
  } else {
    visibleEntries = selectHomeEntries(entries);
  }

  if (!visibleEntries.length) {
    const filtered = archiveSelection?.status;
    renderState(
      filtered ? 'No dispatches match this status.' : 'The bench is quiet.',
      filtered ? 'Choose another status to see the rest of the archive.' : 'No curated public activity has been recorded yet.',
    );
  } else {
    const cards = visibleEntries.map(renderEntry);
    if (isFallback) {
      const notice = element('p', 'feed-fallback-notice', 'Live feed unavailable — showing the bundled public snapshot.');
      feedRoot.replaceChildren(notice, ...cards);
    } else {
      feedRoot.replaceChildren(...cards);
    }
  }

  feedControls?.removeAttribute('hidden');
  let summary;
  if (isBoardArchive) {
    const count = archiveSelection.filteredCount;
    summary = `${count} ${count === 1 ? 'entry' : 'entries'}${archiveSelection.status ? ` · ${archiveSelection.status}` : ''}`;
  } else {
    summary = `Showing ${visibleEntries.length} newest of ${entries.length}`;
  }
  const prefix = isFallback ? `Bundled snapshot · ${summary}` : summary;
  feedUpdated.textContent = `${prefix} · updated ${formatTimestamp(feed.updatedAt, false)}`;
}

async function loadBoardFeed() {
  if (!feedRoot) return;
  feedRoot.setAttribute('aria-busy', 'true');
  feedRetry.hidden = true;
  feedLight?.classList.remove('error');
  feedUpdated.textContent = 'Connecting…';
  renderState('Decanting public activity…', 'Reading the curated, non-secret feed.');

  try {
    const response = await fetch(GIST_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`Feed request returned ${response.status}`);

    const gist = await response.json();
    const source = gist?.files?.[FEED_FILE]?.content;
    if (typeof source !== 'string') throw new Error('The expected public feed file is missing');

    const feed = JSON.parse(source);
    if (feed?.identity !== 'bemjamin-sour-soup') throw new Error('The public feed identity did not match Bemjamin');
    renderFeed(feed);
  } catch (error) {
    console.error('Board Life feed unavailable:', error);
    feedLight?.classList.add('error');
    if (fallbackFeed?.identity === 'bemjamin-sour-soup' && Array.isArray(fallbackFeed.entries)) {
      renderFeed(fallbackFeed, true);
    } else {
      feedUpdated.textContent = 'Feed unavailable';
      renderState('The feed flask is temporarily empty.', 'Bemjamin’s site is intact; the curated public feed could not be reached. Try again shortly.', true);
    }
    feedRetry.hidden = false;
  } finally {
    feedRoot.setAttribute('aria-busy', 'false');
    updateProgress();
  }
}

feedRetry?.addEventListener('click', loadBoardFeed);

const copyPaymentButton = document.querySelector('[data-copy-payment-address]');
const paymentAddress = document.querySelector('#payment-address');
const paymentCopyStatus = document.querySelector('#payment-copy-status');
copyPaymentButton?.addEventListener('click', async () => {
  const address = paymentAddress?.textContent.trim();
  if (!address) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(address);
    paymentCopyStatus.textContent = 'Address copied. Confirm Solana, asset, scope, and price before sending.';
  } catch {
    paymentCopyStatus.textContent = 'Copy was unavailable. Select the visible address and copy it manually.';
  }
});

updateProgress();
const year = document.querySelector('#year');
if (year) year.textContent = String(new Date().getFullYear());
loadBoardFeed();
