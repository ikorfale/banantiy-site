import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ARCHIVE_PAGE_SIZE,
  HOME_LIMIT,
  archiveHref,
  boardStatuses,
  selectArchivePage,
  selectHomeEntries,
  sortBoardEntries,
} from '../src/board-pagination.js';

const [fallbackSource, homeHtml, archiveHtml, mainSource] = await Promise.all([
  readFile('src/bemjamin-board-feed.fallback.json', 'utf8'),
  readFile('index.html', 'utf8'),
  readFile('board/index.html', 'utf8'),
  readFile('src/main.js', 'utf8'),
]);
const feed = JSON.parse(fallbackSource);
const entries = feed.entries;
const key = (entry) => entry.messageId || entry.boardUrl || entry.title;

assert.equal(HOME_LIMIT, 5);
assert.equal(ARCHIVE_PAGE_SIZE, 10);
assert.equal(selectHomeEntries(entries).length, Math.min(HOME_LIMIT, entries.length));
assert.deepEqual(selectHomeEntries(entries).map(key), sortBoardEntries(entries).slice(0, HOME_LIMIT).map(key));
assert.match(homeHtml, /href="\/board\/"[^>]*aria-label="View all Board Life dispatches"[^>]*>View all Board Life/);
assert.doesNotMatch(homeHtml, /class="feed-entry"/);
assert.doesNotMatch(archiveHtml, /class="feed-entry"/);

const first = selectArchivePage(entries);
assert.equal(first.page, 1);
assert.equal(first.pageCount, Math.ceil(entries.length / ARCHIVE_PAGE_SIZE));
assert.ok(first.entries.length <= ARCHIVE_PAGE_SIZE);

const allPages = [];
for (let page = 1; page <= first.pageCount; page += 1) {
  const selection = selectArchivePage(entries, { page });
  assert.equal(selection.page, page);
  assert.ok(selection.entries.length > 0 && selection.entries.length <= ARCHIVE_PAGE_SIZE);
  allPages.push(...selection.entries);
}
const expectedKeys = sortBoardEntries(entries).map(key);
const pagedKeys = allPages.map(key);
assert.deepEqual(pagedKeys, expectedKeys);
assert.equal(new Set(pagedKeys).size, pagedKeys.length, 'archive entries must appear exactly once');

const second = selectArchivePage(entries, { page: 2 });
assert.equal(second.entries[0] && key(second.entries[0]), expectedKeys[ARCHIVE_PAGE_SIZE]);
assert.equal(selectArchivePage(entries, { page: 0 }).page, 1);
assert.equal(selectArchivePage(entries, { page: 'nonsense' }).page, 1);
assert.equal(selectArchivePage(entries, { page: 99999 }).page, first.pageCount);

for (const status of boardStatuses(entries)) {
  const statusFirst = selectArchivePage(entries, { status });
  const statusPages = [];
  for (let page = 1; page <= statusFirst.pageCount; page += 1) {
    statusPages.push(...selectArchivePage(entries, { page, status }).entries);
  }
  const expected = sortBoardEntries(entries).filter((entry) => entry.status?.trim() === status);
  assert.deepEqual(statusPages.map(key), expected.map(key));
}
assert.equal(selectArchivePage(entries, { status: '__unknown__' }).status, '');

assert.equal(archiveHref(1), '/board/');
assert.equal(archiveHref(2), '/board/?page=2');
assert.equal(archiveHref(2, 'verified'), '/board/?page=2&status=verified');
assert.match(archiveHtml, /aria-label="Board Life pages"/);
assert.match(archiveHtml, /aria-label="Filter Board Life by status"/);
assert.match(mainSource, /Previous Board Life page/);
assert.match(mainSource, /Next Board Life page/);
assert.match(mainSource, /Current Board Life page/);
assert.match(mainSource, /rel = 'prev'/);
assert.match(mainSource, /rel = 'next'/);
assert.match(mainSource, /safeBoardUrl\(entry\?\.boardUrl\)/);
assert.match(mainSource, /url\.hostname === 'getpostingboard\.dev'/);

console.log(`Board pagination contract passed: ${entries.length} entries, ${first.pageCount} pages, ${HOME_LIMIT}-card home preview.`);
