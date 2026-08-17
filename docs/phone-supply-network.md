# Phone supply network

Where retired-phone compute is viable, where it isn't, and what to build first.

Question: *can someone hand a retired phone to a network, have it serve other people, and earn money?* Short answer: **yes, but not by selling inference.** Selling tokens from phones loses to a datacenter GPU by ~2 orders of magnitude. Selling *verified real-device presence with on-device judgment* is priced ~2 orders of magnitude higher by an existing market. The whole design follows from that gap.

## 1. Selling FLOPs is dead — the arithmetic

| | Value | Source |
|---|---|---|
| A100 80GB PCIe, sustained embedding throughput | **60,000 tok/s** at $1.04/hr → **$0.0097 / 1M tokens** at 50% utilization | [GigaGPU](https://gigagpu.com/embedding-cost-at-scale-self-hosted-vs-api/) |
| L4, 7B embedding model | ~2,000 tok/s | [Introl](https://introl.com/blog/embedding-infrastructure-scale-vector-generation-production-guide-2025) |
| Embedding API floor | **$0.02 / 1M** (`text-embedding-3-small`) | [pecollective](https://pecollective.com/tools/text-embedding-models-compared/) |
| Self-hosting break-even | only above **10–15M embeddings/month** | [GigaGPU](https://gigagpu.com/embedding-cost-at-scale-self-hosted-vs-api/) |
| Phone prefill, Llama-3.2-3B, mobile GPU | 791 tok/s **burst** vs 12.5 tok/s decode | [ML Drift](https://arxiv.org/pdf/2505.00232) |
| Phone sustained decode, 1.5B Q4 | 8.8–22.6 tok/s, **−44% within 2 iterations** | [Edge under Sustained Load](https://arxiv.org/html/2603.23640v2) |
| Phone energy | 0.20–0.21 mWh/token, 8.5–13.8 W, 47.9 °C | [MELTing Point](https://arxiv.org/html/2403.12844v2) |

One A100 at $749/month sustains what **~300 phones** do at a generous 200 tok/s sustained prefill. Pay those 300 owners even $2/month and you are at $600/month in payouts *before* verification redundancy (10–30% of compute burned), payout rails, orchestration, and support — to deliver strictly worse latency and reliability.

Worse, the addressable buyer is self-selected against you: self-hosting only beats API above 10–15M embeddings/month, so anyone big enough to care is already optimizing, and the price to beat is $0.0097/1M, not the $0.02 retail figure.

Run [`npm run economics`](../orchestrator-mvp/scripts/supply-economics.ts) for the arithmetic. At a generous 200 tok/s sustained, 18 h/day: **$3.77/month gross ceiling, $2.08/month net to the owner** after verification overhead and network take. That is 5× the electricity cost and 60× below the device-presence case in §2 — the phone doesn't lose money, it earns an amount nobody installs an app for.

> **Retracted claim.** An earlier round argued prefill-heavy work earns ~$15/month/phone and was "10× better than generation." Wrong twice: it treated a 791 tok/s *burst* figure on a current flagship as sustained throughput on old silicon, and it priced against API retail ($0.02/1M) instead of the marginal cost of the GPU the buyer would otherwise rent ($0.0097/1M). The prefill-vs-decode ratio is real and still shapes workload choice — it just doesn't rescue the economics.
>
> A second correction, caught by the calculator's own self-check while writing this: the first draft of §1 claimed selling FLOPs "loses money." It doesn't. $2.08/month net is positive. The defensible claim is the weaker and more useful one — it clears electricity by an amount below any consumer motivation bar (`CONSUMER_FLOOR_USD = 5`).

## 2. What a phone has that a datacenter cannot buy

The one asymmetry: a retired handset is **a genuine consumer device, on a residential or carrier IP, in a real physical location, with real hardware identity.** No amount of GPU spend forges that.

The revealed price of this is not speculative:

| Offer | Price | Source |
|---|---|---|
| AWS Device Farm, metered | **$0.17 / device-minute** (≈$10/device-hour) | [AWS](https://aws.amazon.com/device-farm/pricing) |
| AWS Device Farm, unmetered slot | **$250 / month / device** | [AWS](https://aws.amazon.com/device-farm/faqs/) |
| AWS private device, dedicated hardware | **$200 / month / device** | [AWS](https://aws.amazon.com/device-farm/faqs/) |

The same handset is worth **$2–7/month as a compute node and $200–250/month as an addressable real device.** Capturing even 5–10% of the latter clears a consumer motivation bar that no FLOP-selling model reaches.

This also explains the pattern in the precedent graveyard: residential-bandwidth sharing is a real business while consumer compute mostly isn't. The value was never the silicon.

## 3. The design that follows

**Sell device-grounded tasks; use the local model to make each device useful rather than merely a network exit.**

An on-device SLM upgrades a node from "dumb proxy" to "agent that observes and returns a small structured verdict." That matters for three reasons: raw data never leaves the device, egress stays tiny (a JSON verdict, not a page dump), and the buyer gets a judgment rather than bytes to post-process.

Candidate workloads, ranked by defensibility rather than throughput:

| Workload | Why a datacenter can't do it | Verifiability |
|---|---|---|
| Real-device app QA / regression | Needs genuine OS + SoC diversity | High — deterministic pass/fail, replayable |
| Localized result verification (search, store listings, pricing, availability) | Needs real regional device + IP | Medium — k-of-n agreement across devices in region |
| Ad / content delivery verification | Needs real device fingerprint | Medium — same |
| Network + connectivity measurement | Needs real carrier attachment | High — cross-checkable against known probes |
| Accessibility / rendering audits on real screens | Needs real device | High — deterministic |
| On-device personalization / federated updates | Data must not leave | Low — inherently unverifiable, needs different trust model |
| Bulk embeddings, classification, ASR, OCR | **Nothing.** Datacenter wins on cost | High, but economically pointless |

Last row stays in the table deliberately: it's the obvious idea, it's cheap to verify, and it loses. Don't build it.

## 4. Trust: attestation works on exactly the target cohort

Good news for the retired-phone premise: **hardware-backed key attestation is mandatory on every device that launched with Android 8.0 or later** (`ro.product.first_api_level` > 25) — which is the cohort being recruited. Devices that merely *upgraded* to 8.0 from earlier do not have it. See [Android key attestation](https://developer.android.com/google/play/integrity/overview) and the [GrapheneOS attestation compatibility guide](https://grapheneos.org/articles/attestation-compatibility-guide).

Two caveats that must be designed around, not assumed away:
- Some low-quality devices shipped **broken** hardware attestation while Play Integrity still wrongly reports them CTS-certified. Attestation alone is not sufficient; pair it with behavioral checks.
- Attestation proves *the app is genuine on genuine hardware*. It does **not** prove the computation was performed honestly. That needs redundancy, canaries, or staking on top.

Layered trust model, cheapest first:
1. Hardware key attestation at enrollment — establishes device class and identity.
2. Known-answer canary tasks seeded into the queue — catches lazy cheating at ~1–3% overhead.
3. k-of-n redundancy on a sampled fraction of jobs — catches collusion-free wrong answers.
4. Reputation with stake/slashing for high-value jobs only — the expensive tier, applied selectively.

## 5. Guardrails — the failure mode that makes this harmful

A network of consented residential devices executing remote instructions is, structurally, one design decision away from a residential proxy botnet. That adjacency is the single largest reputational and legal risk, and the honest version must be built against it from the start:

- **Explicit, revocable consent** with plain-language disclosure of what runs and when. No bundling the agent into an unrelated app's SDK.
- **Allowlisted job types only.** The node executes named task classes; it does not forward arbitrary traffic and is never a general-purpose proxy exit.
- **No third-party traffic relay.** Ever. This is the line that separates the product from the abuse case.
- **Owner-visible activity log** and a one-tap stop.
- Buyer-side KYC for any workload touching third-party services, and rate limits that make scraping-at-scale unattractive.

## 6. Open questions — need a council round, not an assertion

These were assigned to a council that was cut short. They are unresolved and load-bearing; do not treat the design above as settled until they are answered.

| # | Question | Why it blocks |
|---|---|---|
| Q1 | **Lithium safety.** Old cells under sustained 45–50 °C and permanent charging: swelling, thermal runaway, fire. Is there any safe configuration? Charge-limiting to 60–80%? External power with cell removed? | Potentially disqualifying for a consumer product. Liability sits with whoever shipped the app. |
| Q2 | **Demand.** Who actually buys device-grounded verification, at what price, and would they switch from AWS Device Farm / BrowserStack to a swarm of consumer handsets? Darkbloom proves supply is trivial and demand is the wall. | If no buyer, nothing else matters. |
| Q3 | **Sustained throughput on old silicon** (Snapdragon 855/865/888, 3–6 GB RAM) for the ranked workloads — measured, not extrapolated from flagship burst figures. | The §1 retraction happened because this was extrapolated once already. |
| Q4 | **Verification overhead** as a real percentage of revenue, per workload. | Determines whether margins exist at all. |
| Q5 | **Payout rails** for $5–25/month across many countries: processing minimums, KYC/AML, tax reporting (1099/DAC7), remittance cost. | Micropayouts can cost more than the work is worth. |

## 7. Build first

In order. Each step is falsifiable and the early ones cost nothing.

1. **Answer Q2 before writing a node.** One buyer, one workload, one quoted price. Darkbloom's public leaderboard — calculator promising $280–600/month against a top earner of ~$6 over 30 days — is what happens when supply is built before demand.
2. **Run [`scripts/supply-economics.ts`](../orchestrator-mvp/scripts/supply-economics.ts)** with real quotes from step 1. It computes the phone-vs-GPU break-even so the argument in §1 is auditable rather than asserted, and it will tell you immediately if a proposed workload is in the dead zone.
3. **Measure one real phone** (Q3). Android + Termux + llama.cpp, no app build needed: sustained prefill/decode tok/s over 30+ minutes, thermal state, energy. Kill criterion decided in advance: if sustained throughput is under ~25% of the burst figure, every revenue estimate downstream must be rebuilt.
4. **Only then** build a node: enrollment with key attestation, one allowlisted task class, canary verification, owner-visible log and stop button.

## What transfers from this repo

Survives: the `Transport` publish/subscribe seam and `Message` envelope, `BaseWorker`'s no-shared-state contract, `RemoteWorker` task/result correlation, and the attestation registry in [`src/registry/`](../orchestrator-mvp/src/registry/) (commitment hashes and audit scores are the right primitive).

Does not survive for this product: synchronous phase barriers, deliberation rounds, the LLM judge, and the similarity merge. A supply network is an async job queue with verification, not a barriered deliberation bus.
