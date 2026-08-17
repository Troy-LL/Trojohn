# Phone supply network

**Question:** can someone hand a retired phone to a network, have it serve other people, and earn money?

**Answer: no — not for cash, not at consumer scale.** Two candidate business models were built and both were killed by measurement, not opinion. This document records what was tested, what killed it, and the one narrow thing left standing, so nobody spends a quarter rediscovering it.

> **Scope.** This verdict covers the **consumer-donation** model: a member of the public installs an app and is paid for their own phone. It does **not** cover the **operator-owned phone farm** — retired handsets bought at scale, rooted, racked, actively cooled, with batteries bypassed, run as infrastructure by the party that owns them. That model removes four of the five kills below (no store distribution, no payout rails or KYC, no adverse selection, no consumer battery liability) and turns the question into a pure hardware-TCO comparison against GPUs. It is analysed separately in [`phone-farm-tco.md`](phone-farm-tco.md) and is **open, not refuted**.

Reproduce the arithmetic: `npm run economics`.

```
bulk embeddings (sell FLOPs)        net to owner  $2.08/month
verified device presence            net to owner  $-0.03/month   (1.4% utilization)
device presence, RETRACTED pricing  net to owner  $124/month     ← do not cite
```

Both fail `CONSUMER_FLOOR_USD = 5`. The second *loses money against its own electricity*. The $124 row is preserved only to show what a single missing term was worth.

## 1. Model A — sell inference. Dead: $2.08/month.

An A100 80GB at $1.04/hr sustains 60,000 tok/s → **$0.0097 per 1M tokens** ([GigaGPU](https://gigagpu.com/embedding-cost-at-scale-self-hosted-vs-api/)). One replaces ~300 phones and costs $749/month. Paying 300 owners even $2/month is $600 before verification, payout rails, and orchestration — for worse latency. Self-hosting only beats API above 10–15M embeddings/month, so every addressable buyer is already price-optimizing against $0.0097, not the $0.02 retail figure ([pecollective](https://pecollective.com/tools/text-embedding-models-compared/)).

## 2. Model B — sell verified real-device presence. Dead: −$0.03/month.

The reasoning was: a retired handset is a genuine consumer device on a residential/carrier IP in a real place, and no GPU spend forges that. The reasoning is sound. The pricing was not.

**Two anchor errors, both mine, both the same failure mode — a ceiling read as a unit price:**

| Claimed | Actual | Why it was wrong |
|---|---|---|
| Prefill work earns ~$15/mo/phone | $2–7 gross | Used 791 tok/s **burst** on a current flagship as sustained throughput on old silicon; priced against API retail instead of the GPU the buyer would rent |
| A real device is worth $200–250/mo | **~$10/mo** of hardware value | AWS states *"slots determine concurrency"* — $250 buys a concurrency license against a shared pool, not a handset. Its own breakeven is 1,470 device-minutes = **24.5 device-hours/month, a 3.4% duty cycle** ([AWS pricing](https://aws.amazon.com/device-farm/pricing/)) |

The corrected model needed one term the first draft lacked: **demand ÷ fleet = utilization.** A device-hour price is meaningless if nobody buys the hour. At 30k incumbent devices serving essentially all global demand and a 100k-phone fleet, each phone sells **7.35 of its 540 available device-hours — 1.4% utilization.**

### The five kills, each independently sufficient

1. **The market that already sells device identity pays $1–3/month.** Honeygain pays owners **$0.10–0.20/GB** against Bright Data's **$8.40/GB** retail — supply captures **1.2–2.4%**. Realized: $1–3/month/device; $10–25 only by stacking four networks on one already-burned IP. Seven years, mature demand, real buyers. ([Honeygain](https://www.frugalforless.com/honeygain-review/), [Bright Data](https://dataresearchtools.com/bright-data-pricing-2026/), [1dollaperday](https://1dollaperday.com/blog/honeygain-vs-pawns-vs-earnapp-vs-packetstream))
2. **Nielsen — which needs demographic representativeness and therefore cannot get supply free — pays $3/device/month.** That is the revealed price of a consented consumer device slot, below our own floor. Comscore's MobileXpression has paid ~$5 per user *ever*. Opensignal sources 100M+ devices across 150+ countries for **free** via app + SDK partnerships, paying the app publisher, not the owner. Ookla was acquired for $1.3B on data collected at zero supply cost. ([Nielsen](https://computermobilepanel.nielsen.com/), [Side Hustle Nation](https://www.sidehustlenation.com/get-paid-for-your-data/))
3. **Real-device QA is not supply-constrained.** BrowserStack: 30,000+ devices, 21 datacenters, no waitlists, "No Terminal Available" in <0.0x% of cases. Firebase charges $5/device-hour with a free daily tier — prices in a scarce market do not have free tiers. Device hardware is 2–5% of their cost structure; the other 96% is reimaging, reservation scheduling, ADB/XCUITest tunneling, SLAs, SOC2, support. A swarm supplies the 4% and *destroys* the 96%: CI requires factory-clean state between runs, pinned OS builds, and a device that won't be picked up mid-test. **QA teams don't have a device shortage; they have a flake budget, and a consumer fleet is a flake generator.** ([BrowserStack](https://www.browserstack.com/real-device-cloud), [Firebase](https://firebase.google.com/pricing))
4. **Google Play bans the distribution channel, and it is the same dependency as the trust model.** Play policy permits proxy-to-third-party services *only* where that is the app's primary user-facing purpose — and **Honeygain, which qualified for that safe harbour, is still not on Google Play**, removed under this exact policy. PROXYLIB: 28 apps removed, 17 posing as VPNs. BADBOX 2.0: Google sued 25 entities over a 10M-device proxy botnet in July 2025. The consequence nobody drew: Play Integrity *is* a Play Services API, so you cannot be simultaneously banned from Play and dependent on Google's attestation infrastructure. Attestation and distribution are one dependency, controlled by the party that already ruled against this category. ([Play policy](https://support.google.com/googleplay/android-developer/answer/16559646), [Honeygain](https://support.honeygain.com/hc/en-us/articles/360015490879-Why-is-there-no-Honeygain-application-on-Google-Play-Store), [PROXYLIB](https://www.humansecurity.com/learn/blog/satori-threat-intelligence-alert-proxylib-and-lumiapps-transform-mobile-devices-into-proxy-nodes/), [BADBOX](https://thehackernews.com/2025/07/google-sues-25-chinese-entities-over.html))
5. **The abuse guardrails delete the revenue.** The only price point above $5/month is a dedicated mobile port ($15–100/mo) — which requires being an arbitrary traffic relay with rotation at scale and no questions asked. Those three properties *are* what residential-proxy buyers pay for. Forbid them (correctly) and you keep the compliance cost, the abuse-monitoring cost, the reputational adjacency, and the store ban, and keep none of the revenue. Meanwhile proxy prices collapsed — residential −75%, mobile −98% (>$25/GB → ~$0.50/GB), 250+ providers, demand +50% YoY *while prices fell*. ([Proxidize Proxy Pricing Index 2026](https://proxidize.com/research/proxy-pricing-index-2026/))

### Two supporting kills

- **The on-device model isn't load-bearing.** A 20KB screenshot judged by a frontier cloud VLM costs ~$0.0015 — cheaper than the electricity of running a 3B model to 47.9 °C locally. Best-in-class 2B GUI models reach ~77% ScreenSpot accuracy, and that's *grounding*, not verdict; a QA oracle wrong 1 in 4 times costs more to triage than to omit. And the privacy rationale contradicts the verification design: canaries and k-of-n require shipping the artifact anyway. ([ZonUI-3B](https://arxiv.org/pdf/2506.23491), [ShowUI](https://openaccess.thecvf.com/content/CVPR2025/papers/Lin_ShowUI_One_Vision-Language-Action_Model_for_GUI_Visual_Agent_CVPR_2025_paper.pdf))
- **Adverse selection ranks by adversariality.** The highest-uptime, most professional, most eager supply cohort *is* the click-farm industry — real rooted devices with valid device IDs, already combining residential proxies with fingerprint spoofing, funded by a $32.6B ad-fraud market. Second-best is yield farmers whose IPs are already flagged by every anti-bot vendor. Genuine donors have dead batteries and churn in weeks. ([HUMAN Security](https://www.humansecurity.com/learn/blog/click-fraud-bots-click-farms/))

## 3. Open questions — now answered

| # | Question | Answer |
|---|---|---|
| Q1 | Lithium safety | **Manageable, not a blocker.** Compute heat is 50–80 °C below the 130–160 °C runaway threshold. Real risk is chronic: float charge + heat on an aged cell (below 80% SoH in ~5 months at 100% SoC/25 °C, ~2 months at 40 °C). **An app cannot enforce a charge cap on stock Android** without OEM support or root — so duty-cycling the workload is the only available control. Gate enrollment on ≥80% SoH, fail closed when no SoH signal exists. No incident data exists for this exact use case; Acurast publishes no battery guidance at 270k phones. |
| Q2 | Demand | **No segment supports a consumer-payout business at $5/device-month.** See kills 1–3. |
| Q3 | Sustained throughput on old silicon | **Nobody has measured it.** One datapoint exists: Snapdragon 870, 2–4 tok/s decode, CPU-only, burst. CPU-only is the realistic baseline (Vulkan inconsistent pre-Android 12 on Adreno 640/650/660; NNAPI deprecated). SmolVLM-256M (0.8 GB) and Moondream2 (1.2 GB) fit the 2 GB budget by footprint; expect seconds-to-tens-of-seconds per verdict. |
| Q4 | Verification overhead | **~10–15% of gross** — commit-then-reveal and reputation are structurally free. But two findings reshape the design: **attestation cannot be the fraud control** (Play Integrity Fix / Tricky Store / Shamiko are free, ~30 min, amortized over device lifetime), and **redundancy-compare is invalid, not merely expensive, for localized ground truth** — honest devices legitimately disagree on personalized/A-B-tested results, so k-of-n would slash honest nodes and reward peer-matching over correctness. **Location provenance only survives via carrier/SIM network-attach + cell-ID cross-check**; GPS and IP are both spoofable for ~$0 by anyone already rooting the device. |
| Q5 | Payout rails | **Monthly cash at $5–25 is not viable.** Honeygain's own $20 minimum is the precedent; Payoneer takes 31–66% on a $10 payout. Viable shape: $25 accrual threshold, quarterly-or-on-threshold, PayPal Payouts API (~2.5%) US/EU/UK first. 1099-K reverted to $20,000/200 txns, but 1099-NEC's $600 still applies if structured as contractor pay. **DAC7 may apply with no revenue floor** if this counts as a personal service. "Crypto avoids KYC" is false. An emissions-subsidized token is a *worse* regulatory bet than cash (Howey/MiCA). |

Liability, added by the council: the operator instructs stranger-owned devices to interact with third parties. *Meta v. Bright Data* was won on **logged-off** scraping — a logged-in real consumer device sits on the wrong side of that exact distinction. Under GDPR the operator is controller, owes Art. 28 processor terms to every phone and Art. 32 guarantees on rooted hardware, and is unfundable at $2/device-month.

## 4. What survives

> **A consented, disclosed, non-cash measurement panel selling *aggregate* network/carrier/localization measurements, where the incentive is app utility rather than a payout.**

It survives by giving up the premise. No cash removes yield-farm adverse selection and the entire payout apparatus (Q5 evaporates). Measuring *the network* rather than interacting with third-party services removes the ToS/CFAA/GDPR-controller exposure and the proxy-policy trigger. Aggregate-only removes the per-device utilization requirement, so an idle fleet is fine — which is the term that killed Model B. And connectivity measurement is the one workload where a datacenter genuinely cannot substitute and no incumbent holds 30,000 spare units.

**What it concedes: the owner earns $0.** That is not the question this document was asked. Recorded as the honest boundary of what the evidence supports.

*Uncited and worth checking before anyone gets excited:* this shape may already be fully occupied by Ookla/Opensignal-class panels bundled into utility apps. The council flagged its own claim here as an unverified hypothesis.

## 5. If you want to keep going anyway

Ordered by cost. The first three are library research and close this week.

1. **F1 — read the AWS pricing page and ask sales:** "does one slot mean one reserved physical device?" Predicted FALSE at 95%; the page already says slots are concurrency.
2. **F3 — trial BrowserStack/Sauce/LambdaTest, measure device-acquisition wait at peak.** Predicted FALSE at 90%; their FAQ pre-concedes <0.0x% unavailability.
3. **F4 — pre-launch Play policy inquiry.** Predicted FALSE at 85%. **Do this before measuring any phone.** A passing thermal measurement on a product that cannot be distributed is an expensive way to feel productive.
4. **The three-email supply-price test** — don't ask buyers for quotes, ask incumbents what they *pay for supply*: Opensignal's SDK-partner program, Comscore panel ops, one mobile-proxy supply team. One question: *"what do you pay per consented device per month, and what's your minimum panel size?"* Free, days, returns the clearing price of this exact asset.
5. Only if 1–4 return numbers above $5/device-month: measure one phone (Q3 protocol), then build a node.

## What transfers from this repo

Survives: the `Transport` publish/subscribe seam and `Message` envelope, `BaseWorker`'s no-shared-state contract, `RemoteWorker`'s task/result correlation, and `computeCommitment()` in [`src/registry/attestation.ts`](../orchestrator-mvp/src/registry/attestation.ts) — already a commit-then-reveal primitive, with `penalizeWorker()` as the reputation layer.

Must be replaced for any job-queue product: `RemoteWorker.call()` is a synchronous one-promise-per-task barrier that cannot fan out canaries or redundant copies; the deliberation vocabulary in `MessageType` (`question`/`proposal`/`critique`/`revision`) is dead weight; and [`sessionIndex.ts`](../orchestrator-mvp/src/store/sessionIndex.ts)'s whole-file JSON rewrite fails at per-task volume.

## Method note

Three claims in this document's own history were retracted after measurement: the $15/month prefill figure, the $250/month device anchor, and "selling FLOPs loses money" (it nets $2.08 — the defensible claim was the weaker one). Two were caught by `scripts/supply-economics.ts`'s self-check, one by a council devil's advocate. The pattern in all three was the same: an optimistic ceiling used as a unit price. Keep the calculator adversarial and keep the retractions visible.
