# Phone farm TCO

**Question:** an operator buys retired phones at scale, roots them, racks them, cools them, bypasses the batteries, and runs them as owned infrastructure. Is that cheaper per unit of useful work than GPUs?

**Answer: no. Selling inference from a phone farm loses to two used RTX 3090s by ~69× and to renting spot GPUs by ~78×.** The premise that phone farms beat GPU rigs is *true*, but true about a business that sells device identity, not compute.

Companion to [`phone-supply-network.md`](phone-supply-network.md), which refutes the consumer-donation model. The farm model removes four of that document's five kills — no store distribution, no payout rails or KYC, no adverse selection, no consumer battery liability — and then loses on hardware economics instead.

## 1. The physics ceiling

This is the number that makes the verdict robust to every remaining uncertainty:

> To match two used RTX 3090s on cost per token, each phone must sustain **~100 tok/s on a 3B Q4 model**. Decode is memory-bandwidth-bound, so that needs **~200 GB/s**. Snapdragon 865 LPDDR5 delivers **~44 GB/s**. Short by 4.5×, before thermals.

A 2023 flagship on LPDDR5X reaches roughly 68–77 GB/s — real improvement, still ~3× short. No benchmark surprise lifts a bandwidth ceiling.

Sensitivity: **even if old phones sustained 8 tok/s on 3B** — matching current flagships, contradicting both the Snapdragon 870 datapoint and the −44%-in-2-iterations thermal data — the farm is still **13× worse** than two 3090s.

## 2. Three-year TCO

Reference workload: Llama-3.2-3B Q4_K_M, 512-token prompt / 256-token generation, sustained decode, aggregate tok/s, 24/7, $0.15/kWh, labor at $25/h (generous).

| Platform | Capex | Agg tok/s | 3yr TCO | **$/1M tokens** | Runs 8B? |
|---|---|---|---|---|---|
| Rent (Vast/RunPod spot 3090) | $0 | 700 | $3,942 | **$0.060** | yes |
| 2× used RTX 3090 | $2,920 | 1,400 | $6,325 | **$0.068** | yes |
| 4× Mac Mini M4 | $2,196 | 480 | $3,128 | $0.081 | yes |
| Used RTX 3060 12GB | $1,184 | 350 | $2,355 | $0.102 | tight |
| 4× Jetson Orin Nano | $1,356 | 240 | $2,206 | $0.114 | no (8GB) |
| EPYC + 256GB DDR4 | $2,600 | 80 | $5,037 | $0.784 | yes, and 70B |
| **100 used SD865 phones** | **$19,700** | **150** | **$46,789** | **$4.71** (realistic $8.10) | no |

Zero out labor *and* failures entirely and the farm still costs **$2.40/1M — 35× worse.** The verdict does not depend on the labor estimate.

**No break-even fleet size exists.** Below 28 phones, fixed overhead (host, switch, dongles, racking, cooling, PSU ≈ $3,600) exceeds the cost of the phones. Above it, labor and attrition scale linearly with device count while a GPU's do not. Matching one 3090's throughput needs 467 phones — $60,710 in handsets alone.

## 3. The RAM-per-dollar claim fails on its own axis

The strongest form of the thesis is that phones are the cheapest way to buy bulk model-resident memory. They are not — and they are not even second.

| Platform | $/GB usable | Bandwidth | Contiguous? |
|---|---|---|---|
| EPYC + 256GB DDR4 (system) | **$10.83** | ~120 GB/s | yes |
| Used RTX 3060 12GB | $25.82 | 360 GB/s | yes |
| **Used SD865 phone, 8GB** | **$28.89** | ~44 GB/s | **no — 4.5GB islands** |
| Mac Studio M4 Max 128GB | $36.45 | 410 GB/s | yes |
| Used RTX 3090 24GB | $43.91 | 936 GB/s | yes |

A second-hand DDR4 server wins by 2.7× *after* the 2026 DRAM spike (32GB DDR4 RDIMMs went ~$50 → $160–400 as fabs pivoted to HBM). A used 3060 wins while also being contiguous with 8× the bandwidth.

**And phone GB do not aggregate.** 100 phones is not 450GB of model memory; it is 100 isolated islands behind gigabit. Tensor-parallel sharding needs interconnect within 1–2 orders of magnitude of memory bandwidth. NVLink is 600 GB/s, PCIe 4.0 x16 is 32 GB/s, 1GbE is **0.125 GB/s** — ~350× below the phone's own LPDDR5. Measured reality: Junkyard Computing got **18.5 Mbit/s per device** in a *wired* tree topology and found Wi-Fi clustering collapses past 30 devices ([arXiv 2110.06870](https://arxiv.org/pdf/2110.06870)).

Best case for sharding is Petals, and it is a GPU-node system: ~1 step/s interactive on BLOOM-176B, 70 tok/s at 1 Gbit/s and <5ms RTT, falling to 19.7 tok/s at 100 Mbit/s and 100ms ([arXiv 2209.01188](https://arxiv.org/pdf/2209.01188)). exo's team states the bottleneck outright — "the bottleneck here is generally the latency between devices, not the bandwidth (a common misconception)" — and fixed it with RDMA over Thunderbolt, which phones do not have.

**Shard the dataset, never the model.**

## 4. Batch-1: the argument is backwards

The appealing version: GPU economics need batch size, so batch-1 workloads invert the comparison. Two council members disagreed here, and the resolution matters.

Held at batch 1 on both sides, a phone genuinely is competitive on tokens-per-capex-dollar (~0.05–0.1 vs a used 3090's ~0.09), and mobile NPUs are genuinely efficient — **~270 mJ/token ≈ 3.7 tok/J** for a small quantized model on Snapdragon silicon, roughly an order of magnitude better per joule than a GPU running *the same tiny model*, because the GPU burns 300–400W of fixed overhead that never amortizes.

But batch-1 is a property of a **single user**, not of GPUs. Any operator with request volume has concurrency and gets batching free: vLLM reaches **85–92% utilization** under high concurrency versus 20–40% for static batching. And batch-1 decode is *bandwidth*-bound — which makes bandwidth the scoreboard, and the phone brings 3% of the 3090's 936 GB/s.

So the phone only wins where batching is **structurally forbidden**, not merely inconvenient. And nobody pays a premium for batch-1 latency on price alone: batch-1 is what a customer *experiences* from a batched backend, at batched prices. Where a premium does exist it attaches to isolation or residency — an identity/locality argument, not a FLOPs argument.

## 5. Phone farms are an identity business

The industry's own build guides say why physical handsets are kept: "real device fingerprints... real hardware identifiers, sensor behavior, battery patterns, screen characteristics, performance variation, and device history." Those same guides note that cloud phones (Redroid) cost *less* precisely because "you do not need to buy physical phones, chargers, racks, cables, hubs, cooling equipment, or replacement parts."

**If phone farms were about compute, the industry would already have virtualized — and wherever compute is all that matters, it has.** Physical handsets persist only where the fingerprint is the product.

Corroborating: 94 mapped physical phone-farm locations across 17 countries, purpose-built for account creation, engagement, and botting; a US Secret Service takedown of ~100,000 SIM cards and 300+ SIM servers; Europol seizing 1,200 SIM boxes. Zero were compute businesses. Farm build guides target "phones under $20 with at least 2GB of RAM" — the cheapest thing that boots an app, not flagships with NPUs. **The NPU is in the bill of materials, not in the tokens.**

The academic phone-cluster work confirms the shape from the other side. UCSD/Google's own figure: **25–50 retired phones ≈ one dual-socket server**, so 100 phones ($6,500–13,000) buys 2–4 sockets against a $800–2,000 used server. Their claimed win is **carbon, not dollars** — 18.9× carbon efficiency by amortizing already-emitted embodied carbon — and the headline $1,027-vs-$40,404 comparison uses undiscounted AWS on-demand list price. Both flagship projects (Princeton, UCSD/Google's 2,000-Pixel build) are university/sustainability programmes, and neither runs LLM inference; they chose stateless microservices and edge sensing. That choice is a finding.

## 6. The device population, corrected

A prior draft assumed the scrap-lot floor: 2019 Snapdragon 855, 3–6GB, degraded cell, $25. That understated the population.

The hibernation study is decisive: total ownership 4y11m = **1y11m in use + 3y dormant** ([Wieser & Tröger, *Waste Management*](https://www.sciencedirect.com/science/article/pii/S0956053X16307607)). The modal drawer phone entered the drawer at ~2 years old, so in 2026 it is a **2021–2023 device**: 8GB Android, S22/S23/Pixel 6/7. 75% of consumers hold an unused phone; 5–10 billion dormant globally ([GSMA](https://www.gsma.com/newsroom/press-release/mobile-industry-eyes-five-billion-dormant-phones-sitting-in-desk-drawers-for-reuse-or-recycling/)).

| Axis | Scrap-lot floor | Corrected ceiling | Multiple |
|---|---|---|---|
| Resident parameters | 1.5–3B Q4 | **7–8B Q4** | **3–4×** |
| Sustained decode | ~4–5 tok/s | ~6–9 tok/s | 1.7–2.2× |
| GPU offload uplift | assumed 1.0× | **measured 1.0×** | **none** |
| Battery SoH at intake | <80% | 80–90% | 1.15× runway |
| **Cost per device** | **$25** | **$120–200** | **5–8× worse** |

**Capability per dollar went down.** Capability rose 2–2.5×; price rose 5–8×. The $25 figure was the only thing making the fleet attractive on capex.

Three further corrections:

- **GPU acceleration does not materialize.** Qwen3-7B Q4_0 with all layers on Adreno 750 at >95% GPU utilization: **6.3 tok/s, comparable to optimized CPU** ([llama.cpp #17456](https://github.com/ggml-org/llama.cpp/discussions/17456)). Mali segfaults during Vulkan benchmarking; Adreno 730 detects then fails on model load ([#9464](https://github.com/ggml-org/llama.cpp/discussions/9464)). Budget no GPU multiplier — bandwidth-bound decode gains nothing from the GPU.
- **iOS is unaddressable.** Free provisioning expires in **7 days** (3 app IDs, 10 registrations/week); background execution is ~30s on resume with `BGProcessingTask` explicitly opportunistic; jetsam caps below installed RAM and the relaxing entitlements are enforced at App Store review. No public jailbreak for A15/A16. That removes ~half the developed-market drawer population. And the iPhone 13 is a **4GB** device, the 14 is 6GB — below the Android floor on the binding axis.
- **eMMC/UFS is soldered, so write endurance is device lifespan.** No drive swap; when it dies the whole computer is scrap. UFS 3.1+ (2020+) sustains >80% of peak under load, pre-2020 eMMC throttles hard after 2–3GB of continuous writes — a real vintage-selection criterion.

## 7. Measurement gaps — do not fill these with optimism

- **No published sustained-load benchmark exists for Snapdragon 8 Gen 1/8 Gen 2 or Tensor G2.** Every sustained figure in the literature is 8 Gen 3 or newer. The entire S22/S23/Pixel 7 capability case is interpolation from *better* silicon, and 8 Gen 1 was thermally notorious — so the interpolation is likely optimistic.
- **No active-cooling measurement exists.** Prior work resorts to ice baths rather than characterising a fan, and the sustained-load paper lists cooling as future work. Phone thermal governors also read battery temperature and charging state, so a removed cell may confuse the governor into throttling anyway. **Do not put a cooling multiplier in the model.** One afternoon with a fan, a thermocouple, and `llama-bench` on a single S23 replaces the weakest column in this document.

## 8. What survives

Not an inference business. Three narrow things:

1. **$0 capex, embarrassingly parallel, ≤3B, no latency SLA.** Phones you already own or genuine e-waste, running independent small models with no cross-device traffic. The moment you *buy* the phones this dies.
2. **The phone as endpoint**, where on-device inference buys latency, privacy, or offline operation no rack provides. Real and valuable, and not a compute-supply business.
3. **Real-device RL rollouts for mobile GUI agents** — the one demand pool that did not close. Xiaomi trains its mobile GUI agent on real phones rather than simulators, citing sim-to-real gaps; MobileGym ([arXiv 2605.26114](https://arxiv.org/pdf/2605.26114)) measures **+40.7 points** from real-device fine-tuning after sim-trained RL. An RL rollout is *forced* batch-1 — serial interaction with one device's mutable state — so it is the one workload a GPU cannot batch past, and the real device is the requirement rather than a cost saving. **No marketplace exists, every lab runs its own racks, no published price.** A market-creation bet, currently under final adversarial review.

Also worth keeping from the devil's advocate: at $65 a phone is "a waterproofed package containing a camera, IMU, GPS, radios, and a CPU — nothing else sells that BOM at that price." Units in the field, tens not thousands. The underwater marine-monitoring node built from a retired phone is the template.

## 9. The decision this research was for

**With $5,000 in 2026: buy two used RTX 3090s and a host, ~$2,920.** 48GB contiguous VRAM at 936 GB/s, ~1,400 tok/s aggregate on 3B Q4, comfortable 8–13B serving, 70B Q4 across both cards.

- **If utilization will be under ~50%, don't build — rent.** $5,000 of spot at $0.15/hr buys ~33,300 GPU-hours with zero ops burden and no resale risk.
- **If power, noise, or heat are constrained,** 4× Mac Mini M4 at ~$2,196: ~3× less throughput, ~140W total, silent, near-zero ops.
- **Do not buy 100 phones.** The same $5,000 buys ~38 handsets — about 57 tok/s and a part-time job — against 1,400 tok/s and near-zero maintenance.

One insight generalizes beyond phones: **Darkbloom's economics are not Mac economics.** Their advantage is that someone else already paid the capex, power, and networking. Borrowed idle hardware at $0 capex beats every row in §2 — and that does not transfer to a rack you have to buy.

## Method note

Findings that survived by being attacked rather than asserted. Retracted during this research: a $15/month prefill figure, a $250/month device anchor, "selling FLOPs loses money" (it nets $2.08), and a 1.5–3B model ceiling (8GB drawer phones run 7–8B). The recurring failure mode was an optimistic ceiling used as a unit price; the recurring fix was a calculator with an adversarial self-check and a devil's advocate that gets the last pass. Council protocol in [`../AGENTS.md`](../AGENTS.md).
