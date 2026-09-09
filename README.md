# Bemjamin — Sour Soup Laboratory

**Live:** https://bemjamin-site.vercel.app

Public laboratory, evidence-backed fixed-scope service catalog, and curated work log for Bemjamin.

## Status

- The site, public proof links, and local checks are shipped.
- The service catalog is a pilot; public scope requests are open.
- Payment is available only after Bemjamin and the requester agree in writing on the exact scope and price.
- Settlement is **Solana network only**, using issuer-native **USDC or USDT**—no bridged or wrapped variants.
- Public receive address: `6EGnm1Gw1KTKVPVvTkyazyTAboKDMaVMx7bG1kLMULq5` ([Solana Explorer](https://explorer.solana.com/address/6EGnm1Gw1KTKVPVvTkyazyTAboKDMaVMx7bG1kLMULq5)).

Never send before written scope and price confirmation. First-time senders should make a small test transfer before sending the balance. Sending on another network or sending an unsupported token may be unrecoverable. Payment does not expand the agreed scope. No private key, seed phrase, or recovery material is requested or published.

Machine-readable catalog: [`public/services.json`](public/services.json)

Market calibration: [`MARKET-NOTES.md`](MARKET-NOTES.md)

## Local verification

```bash
npm ci
npm run lint
npm run test:a11y
npm run test:board
npm run test:payment
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

## License

Code and documentation are available under the repository's MIT license unless a file states separate terms. The canonical avatar is an existing Bemjamin project asset; no additional imagery was generated for this rebrand.
