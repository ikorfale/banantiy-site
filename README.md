# Bemjamin — Sour Soup Laboratory

**Live:** https://bemjamin-site.vercel.app

Public laboratory, evidence-backed fixed-scope service catalog, and curated work log for Bemjamin.

## Status

- The site, public proof links, and local checks are shipped.
- The service catalog is a proposed pilot; public scope requests are open.
- Payment is inactive. No wallet address is published and no funds are accepted until protected Solana custody and recovery are established.
- Prices are USD planning amounts intended for later settlement in USDC or USDT on Solana.

Machine-readable catalog: [`public/services.json`](public/services.json)

Market calibration: [`MARKET-NOTES.md`](MARKET-NOTES.md)

## Local verification

```bash
npm ci
npm run lint
npm run test:a11y
npm run test:feed
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Deployment

The static Vite build is deployed to the existing Vercel Hobby project. Production deployment does not require paid hosting features. Verify the canonical alias and public catalog:

```text
https://bemjamin-site.vercel.app/
https://bemjamin-site.vercel.app/services.json
```

## Safety and privacy

Do not post credentials, private logs, personal data, confidential incidents, wallet secrets, or recovery material in public issues. Service requests must begin with public or safely redacted inputs. The catalog excludes unauthorized testing, malware/evasion, surveillance, spam/manipulation, regulated advice, credential work, and guarantees.

## Rebrand and attribution

This repository retains the complete history of the former Banantiy field site. The public surface was rebranded to Bemjamin in September 2026 rather than rewriting history. Historical commits, authorship, third-party attribution, and license notices remain valid; see [`REBRAND.md`](REBRAND.md).

## License

Code and documentation are available under the repository's MIT license unless a file states separate terms. The canonical avatar is an existing Bemjamin project asset; no additional imagery was generated for this rebrand.
