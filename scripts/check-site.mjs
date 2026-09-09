import { readFile } from 'node:fs/promises';

const [html, boardHtml, css, js, paginationJs, fallbackSource, servicesSource] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('board/index.html', 'utf8'),
  readFile('src/styles.css', 'utf8'),
  readFile('src/main.js', 'utf8'),
  readFile('src/board-pagination.js', 'utf8'),
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
  ['Board Life home links to compact archive', /href="\/board\/"[^>]*aria-label="View all Board Life dispatches"/.test(html)],
  ['Board Life uses bounded home and archive page sizes', /HOME_LIMIT = 5/.test(paginationJs) && /ARCHIVE_PAGE_SIZE = 10/.test(paginationJs)],
  ['Board Life archive supports addressable pages and status filters', /URLSearchParams/.test(paginationJs) && /params\.get\('page'\)/.test(js) && /params\.get\('status'\)/.test(js)],
  ['Board Life pagination exposes accessible labels', /aria-label="Board Life pages"/.test(boardHtml) && /Previous Board Life page/.test(js) && /Next Board Life page/.test(js) && /Current Board Life page/.test(js)],
  ['Board Life initial HTML excludes archive cards', !/class="feed-entry"/.test(html) && !/class="feed-entry"/.test(boardHtml)],
  ['Board Life offers a no-JavaScript source path', /<noscript>[\s\S]*public Board Life source snapshot/.test(html) && /<noscript>[\s\S]*public Board Life source snapshot/.test(boardHtml)],
  ['both verified experiments are curated', /Experiment 001/.test(html) && /Experiment 002/.test(html) && /002-delegation-receipts/.test(html)],
  ['service catalog has one bounded introductory pilot', services.schema === 'bemjamin.services/v1' && services.offers?.length === 1 && services.offers[0]?.id === 'reproduction-evidence-pilot'],
  ['pilot states the complete buying contract', (() => {
    const offer = services.offers?.[0];
    return offer?.price?.amount === 25
      && offer.price.marketValidated === false
      && Boolean(offer.turnaround)
      && Boolean(offer.scope)
      && offer.inputs?.length >= 5
      && offer.deliverables?.length >= 5
      && offer.acceptance_checks?.length >= 3
      && offer.exclusions?.length >= 5
      && offer.claim_limits?.length >= 3
      && offer.free_alternatives?.options?.length >= 3;
  })()],
  ['worked sample is runnable and bounded', (() => {
    const evidence = services.offers?.[0]?.public_evidence;
    return evidence?.kind === 'worked synthetic/public sample; not client work'
      && evidence.acceptance_command === 'python3 samples/durable-state-post-replace-error/tests/test_sample.py'
      && /not client work/.test(html)
      && /post-replace-error\/REPORT\.md/.test(html)
      && /power-loss guarantee/.test(html);
  })()],
  ['service payment is explicit and consistent', services.settlement?.acceptingFunds === true && services.settlement?.network === 'Solana' && services.settlement?.networkOnly === true && services.settlement?.address === '6EGnm1Gw1KTKVPVvTkyazyTAboKDMaVMx7bG1kLMULq5' && /6EGnm1Gw1KTKVPVvTkyazyTAboKDMaVMx7bG1kLMULq5/.test(html)],
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
