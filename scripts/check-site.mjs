import { readFile } from 'node:fs/promises';

const [html, css, js, fallbackSource, servicesSource] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/styles.css', 'utf8'),
  readFile('src/main.js', 'utf8'),
  readFile('src/bemjamin-board-feed.fallback.json', 'utf8'),
  readFile('public/services.json', 'utf8'),
]);
const fallback = JSON.parse(fallbackSource);
const services = JSON.parse(servicesSource);

const checks = [
  ['English language declaration', /<html lang="en">/.test(html)],
  ['single primary heading', (html.match(/<h1(?:\s|>)/g) || []).length === 1],
  ['main landmark and skip link', /href="#main"[^>]*>Skip/.test(html) && /<main id="main">/.test(html)],
  ['meaningful hero alt text', /<img[^>]+alt="[^"]{40,}"/.test(html)],
  ['favicon', /rel="icon"/.test(html)],
  ['description metadata', /name="description" content="[^"]+"/.test(html)],
  ['Open Graph title, description, and image', ['og:title', 'og:description', 'og:image'].every((value) => html.includes(`property="${value}"`))],
  ['no empty links', !/<a[^>]+href=""/.test(html)],
  ['no target blank opener risk', !/target="_blank"/.test(html)],
  ['mobile breakpoint', /@media \(max-width: 640px\)/.test(css)],
  ['tablet breakpoint', /@media \(max-width: 900px\)/.test(css)],
  ['visible keyboard focus', /:focus-visible/.test(css)],
  ['reduced motion support', /prefers-reduced-motion: reduce/.test(css)],
  ['minimum tap target height', /min-height: 3\.25rem/.test(css)],
  ['menu exposes expanded state', /setAttribute\('aria-expanded'/.test(js)],
  ['Escape closes mobile menu', /event\.key === 'Escape'/.test(js)],
  ['Board Life is linked from navigation', /href="#board-life"/.test(html)],
  ['both verified experiments are curated', /Experiment 001/.test(html) && /Experiment 002/.test(html) && /002-delegation-receipts/.test(html)],
  ['service catalog has five bounded offers', services.schema === 'bemjamin.services/v1' && services.offers?.length === 5],
  ['service payment fails closed', services.settlement?.accepting_funds === false && services.settlement?.address === null],
  ['service process is explicit', /Request → scope → test → evidence → delivery/.test(html)],
  ['service limits and intake are public', /id="proof"/.test(html) && /id="faq"/.test(html) && /service-request\.yml/.test(html)],
  ['canonical avatar is the only visual asset referenced', /bemjamin-avatar\.png/.test(html) && !/bemjamin-lab-hero/.test(html)],
  ['curated mirror boundary is explicit', /Curated mirror, not the whole board\./.test(html)],
  ['feed has loading and non-JavaScript states', /Decanting public activity/.test(html) && /<noscript>/.test(html)],
  ['public Gist API is the only feed endpoint', /api\.github\.com\/gists\/20b3f61e6f0857915e94251a636b5ee3/.test(js)],
  ['feed renders untrusted text without HTML injection', /node\.textContent = String\(text\)/.test(js) && !/innerHTML/.test(js)],
  ['feed includes explicit empty and error states', /The bench is quiet\./.test(js) && /Live feed unavailable/.test(js)],
  ['bundled fallback has the intro post body', fallback.entries.some((entry) => entry.body?.includes('Hello from Bemjamin, the Sour Soup Professor'))],
  ['live records are backfilled from bundled snapshots', /mergeSnapshotFields/.test(js) && /fallbackFeed/.test(js)],
  ['discussion summaries and next follow-ups are supported', /discussionSummary/.test(js) && /nextFollowUp/.test(js)],
  ['board links are restricted to the intended host', /url\.hostname === 'getpostingboard\.dev'/.test(js)],
];

const failures = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
if (failures.length) {
  process.exitCode = 1;
  throw new Error(`${failures.length} static quality check(s) failed`);
}
console.log(`Static accessibility/responsive checks passed (${checks.length}/${checks.length}).`);
