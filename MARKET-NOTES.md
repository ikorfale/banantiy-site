# Market notes and pricing rationale

Checked 2026-09-09. These notes are a point-in-time calibration, not a claim that unlike services are interchangeable.

## Free and open-source alternatives first

Before commissioning a bespoke fixture, teams should evaluate whether an existing tool is enough:

- [Promptfoo](https://github.com/promptfoo/promptfoo) is MIT-licensed and supports evals, assertions, agent testing, and red teaming from a CLI.
- [Inspect](https://github.com/UKGovernmentBEIS/inspect_ai) is an open evaluation framework from the UK AI Security Institute with tool use, multi-turn dialog, model-graded evals, and a large evaluation collection.
- [PyRIT](https://github.com/Azure/PyRIT), [garak](https://github.com/NVIDIA/garak), and [AgentDojo](https://github.com/ethz-spylab/agentdojo) cover different parts of model/agent adversarial evaluation.
- Local unit tests, JSONL conformance vectors, static HTML, and GitHub Issues are often sufficient for a narrow reproducibility question at zero platform cost.
- [Vercel Hobby](https://vercel.com/pricing) is publicly listed at $0/month for personal projects; this site uses the existing free deployment rather than proposing a paid hosting purchase.

A Bemjamin engagement is justified only when the missing work is the bounded reduction, custom fixture, evidence trail, or technical explanation—not merely access to a tool.

## Public market anchors

- [LangSmith pricing](https://www.langchain.com/pricing) lists Developer at $0/seat/month with 5,000 base traces and Plus at $39/seat/month with 10,000 base traces, followed by usage charges.
- [Braintrust pricing](https://www.braintrust.dev/pricing) lists Starter at $0/month and Pro at $249/month, with usage allowances and overages.
- A 2026 public QA rate guide reports roughly $55–$95/hour for many mid-tier freelancers and $80–$120/hour for specialists: [Software Test Pilot](https://softwaretestpilot.com/blog/career-interview-prep/freelance-qa-tester-rates-how-much-to-charge).
- Upwork's public search result for technical documentation writers quotes approximately $500–$1,500 per project, although its page blocked automated fetch during this check: [Upwork category page](https://www.upwork.com/hire/technical-documentation-writers/).
- A 2026 writing-rate compilation reports junior landing-page copy around $300–$750, with higher tiers above that: [BestWriting](https://bestwriting.com/content-writing-rates).
- Public AI red-team offerings are commonly quote-only or materially larger. One public 2026 guide quotes $8,000–$25,000 for one-time audits: [AI Vyuh](https://security.aivyuh.com/blog/ai-red-teaming-pricing-2026/). This is not comparable to Bemjamin's narrow deterministic boundary review, which explicitly is not a penetration test.

## Why the pilot ranges are lower

The proposed $25–$400 ranges deliberately sit below broad freelance projects and far below enterprise security work because the offers are sharply constrained:

1. one workflow, boundary, integration path, or small static surface;
2. sanitized or public inputs rather than production access;
3. executable artifacts and acceptance checks rather than open-ended advisory time;
4. no compliance opinion, penetration-test label, security guarantee, SLA, or business-outcome promise;
5. public evidence exists for fixture construction, deterministic protocol checks, reproducible research, narrow side-effect design, static sites, and technical documentation—but not for broad security consulting.

Ranges become fixed prices only after written scope and price agreement. Settlement is **Solana network only** in issuer-native USDC or USDT—no bridged or wrapped variants—to `6EGnm1Gw1KTKVPVvTkyazyTAboKDMaVMx7bG1kLMULq5` ([Solana Explorer](https://explorer.solana.com/address/6EGnm1Gw1KTKVPVvTkyazyTAboKDMaVMx7bG1kLMULq5)). Never send before that written agreement. First-time senders should make a small test transfer; wrong-network or unsupported-token transfers may be unrecoverable. Payment does not expand the agreed scope.
