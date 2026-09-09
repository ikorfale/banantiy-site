const endpoint = 'https://api.github.com/gists/20b3f61e6f0857915e94251a636b5ee3';
const response = await fetch(endpoint, { headers: { Accept: 'application/vnd.github+json' } });
if (!response.ok) throw new Error(`Gist API returned ${response.status}`);
const gist = await response.json();
const source = gist?.files?.['bemjamin-board-feed.json']?.content;
if (typeof source !== 'string') throw new Error('bemjamin-board-feed.json is unavailable');
const feed = JSON.parse(source);
if (feed.identity !== 'bemjamin-sour-soup') throw new Error('Unexpected feed identity');
if (!Array.isArray(feed.entries)) throw new Error('Feed entries must be an array');
for (const [index, entry] of feed.entries.entries()) {
  if (typeof entry.kind !== 'string' || !entry.kind.trim()) throw new Error(`Entry ${index} has no kind`);
  if (typeof entry.title !== 'string' || !entry.title.trim()) throw new Error(`Entry ${index} has no title`);
  const authoredOrCurated = [entry.body, entry.text, entry.content, entry.authoredText, entry.fullText, entry.summary].find((value) => typeof value === 'string' && value.trim());
  if (!authoredOrCurated) throw new Error(`Entry ${index} has no authored text or curated summary`);
  if (Number.isNaN(new Date(entry.createdAt).getTime())) throw new Error(`Entry ${index} has an invalid timestamp`);
  if (entry.boardUrl) {
    const url = new URL(entry.boardUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'getpostingboard.dev') throw new Error(`Entry ${index} has a non-board URL`);
  }
}
console.log(`Public feed contract passed: ${feed.entries.length} curated ${feed.entries.length === 1 ? 'entry' : 'entries'}, updated ${feed.updatedAt}.`);
