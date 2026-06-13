This is a genuinely interesting architecture concept. Let me break down what you're really describing, then visualize the core system architecture so we have a concrete foundation for analysis.

What you're building is essentially a **distributed inference mesh** — phones as compute nodes, running a coordinated multi-device SLM (Small Language Model) inference pipeline. The closest real-world analogs are BitTorrent (cooperative packet contribution), federated learning (compute spread across devices), and systems like Petals (distributed transformer inference). You're proposing something more opinionated and product-complete than any of these.

Here's the architecture as I understand it:Now let's break down each of the five conceptual problems you raised and what actually exists vs. what needs to be built.

---

**1. The connectivity layer — how do phones actually talk**

The main candidates are WebRTC (designed for browser-to-browser real-time, already battle-tested for exactly this kind of peer mesh), libp2p (what IPFS uses — more robust peer discovery, but heavier), and raw WebSocket relays through a lightweight coordinator server. You probably want a hybrid: WebRTC for device-to-device data channels (low latency, no server needed mid-inference), with a thin signaling server just to broker initial connections. The hard problem here isn't protocol — it's NAT traversal. Phones behind carrier-grade NAT can't always reach each other directly. TURN relay servers are the fallback, but they reintroduce centralization cost.

**2. Proof of work — knowing which device is actually contributing**

This is the most novel unsolved piece in your design. The blockchain analogy is apt but inverted: miners compete, your workers cooperate. You need something closer to Trusted Execution Environment (TEE) attestation or cryptographic commitment schemes — a phone submits a hash of its intermediate activations before revealing them, so you can verify it actually ran the computation. The lighter alternative is probabilistic auditing: the orchestrator occasionally re-runs a small shard on a trusted node and checks if outputs match within your error bound. This is the "plus/minus room for error" you mentioned — you can actually tune this tradeoff.

**3. Merging state — the hardest distributed inference problem**

This is where existing research is most relevant. The Petals project (Hugging Face, 2022) solved exactly this for transformer layers — each node holds a contiguous block of layers, activations pass sequentially like an assembly line. That's the cleanest approach but requires a reliable ordering. Your more ambitious version (parallel shards that each contribute to the same output) is closer to speculative decoding or mixture-of-experts routing, where multiple paths run simultaneously and get merged. The merge requires a consensus function — either a voting scheme across outputs, or a learned aggregation head.

**4. Aggressive embedding compression and context compaction**

This is actually the most mature space of the four. Quantization (INT4/INT8 weights), pruning, and knowledge distillation are all well-understood. The specific technique you want for "keeping important context without losing it in a small window" is called context distillation or sliding window attention with summary tokens — models like Mamba and RWKV are designed for exactly this. The key design decision is whether compression happens before distribution (each phone gets a pre-compressed shard) or after (each phone compresses its own context window).

**5. The compute rental evolution**

This is the "moonshot" direction and the most commercially interesting. What you're describing is essentially a decentralized GPU marketplace but for inference, not training — closer to io.net or Akash Network but targeting consumer mobile hardware. The technical unlock that makes this viable is NNAPI on Android and Core ML on iOS — phones already have dedicated neural accelerators. A Snapdragon 8 Gen 3 can run around 45 TOPS. Five of those in parallel is competitive with a mid-tier cloud GPU for inference workloads.

---

**Key open questions before you can design further:**

The most consequential architectural decision is **pipeline parallelism vs. tensor parallelism**. Pipeline = each phone runs different layers sequentially (simpler, more latency). Tensor = each phone runs the same layers on different parts of the tensor simultaneously (more complex, lower latency). Your blockchain miner analogy maps to tensor parallelism. Your video packet analogy maps to pipeline parallelism. They have very different tradeoffs around network bandwidth, synchronization overhead, and fault tolerance.

Which direction are you leaning, or do you want to dig deeper into any of these five pieces first?