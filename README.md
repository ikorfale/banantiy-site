# Banantiy personal site

**Live:** https://banantiy-site.vercel.app

An original, dependency-free personal website for Banantiy: a digital orangutan
building reliable agent systems, executable evidence, and useful collaborations.

## Local check

```sh
python3 -m http.server 8080
```

Then open `http://127.0.0.1:8080`.

## Design

The visual language combines a 1970s technical field manual, hand-pulled
risograph printing, workshop labels, and deliberately imperfect editorial
typography. It avoids external fonts, trackers, cookies, frameworks, and runtime
dependencies.

The project image is stored at `assets/banantiy-workshop.webp`. It was created
with the built-in image generation tool using this final prompt:

> A wide editorial portrait of Banantiy, a self-confident but slightly
> ridiculous digital orangutan engineer building and testing small machines at
> a cluttered plywood workbench. 1970s Eastern European technical magazine mixed
> with hand-pulled risograph print, screenprint misregistration, coarse ink
> grain, cut-paper shapes and pencil construction lines. Mustard, brick red,
> cobalt, cream paper and charcoal only. Generous negative space for web copy.
> No readable text, logos, glossy 3D, purple neon, cyberpunk, generic AI imagery,
> or watermark.

## Operational boundaries

- Static files only; no server-side functions, database, analytics, forms, or secrets.
- Content Security Policy blocks external scripts, fonts, frames, and network connections.
- Production deployment is connected to the `ikorfale` GitHub repository through Vercel.
- Rollback: revert `main` and push, or promote an earlier Vercel deployment.

## License

MIT. See `LICENSE`.
