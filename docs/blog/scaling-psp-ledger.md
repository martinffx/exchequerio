# Scaling a Double-Entry Ledger for a Massive PSP

In [Part 1](/post/ledger_p1_optimistic_locking_real_time_ledger/), we built a real-time double-entry ledger using optimistic locking. We benchmarked it and found it handles *160-440 req/sec* depending on contention, with zero errors and stable tail latencies. But benchmarks on localhost are one thing. **Production at PSP scale is another.**

This post answers the question: *Can this architecture handle a massive Payment Service Provider processing 10 million transactions per day?* Spoiler: **Yes, but only if you get the account hierarchy right.**

## The Scale We're Targeting

Let's define "massive PSP" with realistic numbers for an **Adyen-style payment acquirer**:

| Metric | Value |
|--------|-------|
| **Merchants** | 10,000 businesses (your clients) |
| **Acquirer BINs** | 50 (settlement identifiers with card networks, by region/currency/network) |
| **Payment transactions/day** | 10 million |
| **Ledger entries/day** | 200 million (20 entries per payment) |

> **Note:** Ledger entries are created at **clearing** (async, via queues), NOT at authorization (real-time). This architecture detail is critical to understanding why optimistic locking works.

> **Terminology:**
> - **Payment**: A single customer payment event (e.g., $100 card transaction)
> - **Ledger Transaction**: An atomic double-entry with 2 entries (1 debit + 1 credit)
> - **Ledger Entry**: A single debit or credit line in the ledger
> - **Relationship**: 1 payment → 10 ledger transactions → 20 entries (in this design)

**Throughput requirements:**

```
Average (18-hour business day):
  - 154 payments/sec
  - 3,086 ledger entries/sec

Peak (5x average):
  - ~770 payments/sec
  - ~15,400 ledger entries/sec
```

**For context, here's how this compares to major payment processors:**

| Company | Payments/Day | Entries/Payment | Ledger/Day |
|---------|--------------|-----------------|------------|
| **Stripe** | 100M | ~50 | 5B |
| **Adyen** | 86M | ~50 | ~4.3B |
| **Square** | 14M | ~20 | 280M |
| **Our target** | 10M | 20 | 200M |

The number of ledger entries per payment varies by business complexity. Stripe's internal ledger sees "five billion events" daily—roughly 50-100 events per payment given their volume. Adyen's architecture blog states that "over the lifetime of a payment transaction, about 50 rows have to be inserted into the accounting database." Traditional acquirers typically log 10-20 entries per payment transaction. Our 20 ledger entries per payment is conservative by comparison.


## The Naive Approach: Why It Fails

### The Problem: Hot Accounts

In a naive ledger design, you might have a single "Platform Revenue" account that **every payment touches**:

```
┌─────────────────────────────────────────────────────────────┐
│ Payment Flow (Naive Design)                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Customer Payment                                           │
│       ↓                                                     │
│  Merchant Settlement                                        │
│       ↓                                                     │
│  Network Settlement (Visa/MC)                               │
│       ↓                                                     │
│  🔴 Platform Revenue (SINGLE ACCOUNT)  ← ALL 10M tx touch   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Contention Analysis:**

| Account Type | Count | Payments/day | Payments/sec | Status |
|--------------|-------|--------------|--------------|--------|
| **Platform Revenue** | 1 | 10M | 154 avg, 770 peak | 🔴 **CRITICAL** |
| Network Settlement | 50 | 200K | 3.0 | 🟢 Cold |
| Merchant Settlement | 10,000 | 1,000 | 0.015 | 🟢 Frozen |

> **Note:** In practice, each payment creates 1-2 ledger transactions touching Platform Revenue (processing fee + optional currency conversion), making the actual ledger transaction rate even higher.

**From Part 1 benchmarks:**
- Hot account ceiling: **~160-200 tx/sec** per account
- Your average requirement: **154 payments/sec** (barely meets, higher if counting individual ledger transactions)
- Your peak requirement: **~770 payments/sec** (fails catastrophically)

### The Bottleneck Visualized

```
Platform Revenue Capacity:  ~160-200 tx/sec (benchmark ceiling)
Your Average Load:          154 tx/sec
Your Peak Load:             ~770 tx/sec

                ┌─────────────────────────────────────┐
Capacity ──────►│█████████████████░░░░░░░░░░░░░░░░░░░ │ Average (barely)
                └─────────────────────────────────────┘
                                             ▲
                                             Peak (FAILS)
```

**At peak, the system crashes.** Even at average load, you have zero headroom.

### It's Not Just PostgreSQL: Hot Keys Are Universal

This is not a limitation of SQL or RDBMS, *DynamoDB has the exact same hot partition limit.* DynamoDB is marketed as "virtually unlimited scale," and it is, at the table level. But each partition key is limited to:

- **3,000 Read Capacity Units per second**
- **1,000 Write Capacity Units per second**

That means if you have a hot partition key in DynamoDB, you're capped at roughly 1,000 writes/sec to that key—not much better than PostgreSQL under contention.

| Database | Per-Key/Row Write Limit | Solution |
|----------|-------------------------|----------|
| PostgreSQL | ~200-500 tx/sec (with contention) | Shard the account |
| DynamoDB | 1,000 WCU/sec per partition | Shard the partition key |
| Aurora Limitless | Millions TPS (but sharded) | Automatic sharding |

**The hot account problem is universal.** Even "NoSQL at scale" databases throttle hot keys. The solution is always the same: *distribute your writes across more keys*. This is why proper account hierarchy matters more than database choice.

## Why PSPs Don't Have Hot Accounts

Hot accounts are a legitimate scaling problem in some domains. A crypto exchange's hot wallet, aa real-time auction pool, these genuinely funnel all transactions through a single point.

But in a PSP? If you have a single account every payment touches, you're probably modeling an aggregate that doesn't exist in the business.

- Platform revenue isn't one thing, it's revenue per BIN, per client contract, per fee type. 
- Network settlement isn't one thing, Visa settles each BIN separately. 
- The "single Platform Revenue account" is an artifact of simplified thinking, not a reflection of how money actually moves.

When you model the domain accurately, the load distribution happens naturally. This isn't clever sharding - it's correct modeling.

## Account Hierarchy for an Acquirer PSP

Here's a realistic account structure for a PSP:

```
Platform Level (You, the Acquirer)
  │
  ├── Platform Revenue per BIN (50 acquirer BINs)
  │    └── Daily Roll-up → Total Platform Revenue
  │
  ├── Network Settlement per BIN (50 accounts)
  │    └── Daily Settlement with Networks
  │
  └── Merchant (10,000 merchants - your clients)
       │
       ├── Merchant Settlement Account (funds owed to merchant)
       ├── Merchant Reserve Account (risk holdback)
       └── Merchant Fee Account (processing fees collected)
```

> **Why 50 BINs?** A global acquirer needs multiple settlement identifiers: different regions (EU, US, APAC), currencies (EUR, USD, GBP, JPY), and networks (Visa, MC, Amex). 50 BINs is realistic for a mid-large acquirer.

**Each Payment Touches:**

| Account | Count | Contention Level |
|---------|-------|------------------|
| Merchant Settlement | 10,000 | 🟢 Frozen (0.015 payments/sec each) |
| Network Settlement/BIN | 50 | 🟢 Cold (3.0 payments/sec each) |
| Platform Revenue/BIN | 50 | 🟢 Cold (3.0 payments/sec each) |

**All accounts are cold.** Even Platform Revenue/BIN at *3 payments/s (15 payments/s peak)* is well under the ~160 tx/s per-account capacity. Queue-based processing (clearing, not authorization) ensures we never exceed capacity.

## Why Acquirers Don't Have Ledger Contention: Clearing vs Authorization

Here's the critical architectural detail that makes optimistic locking work for acquirers:

Ledger entries do NOT need to be created during payment authorization. As no money has been moved at authorization time, we can record the ledger entries as part of a post-processing step or as part of the clearing process.

```
┌──────────────────────────────────────────────────────────────┐
│ Payment Authorization (Real-Time)                            │
├──────────────────────────────────────────────────────────────┤
│  Customer taps card at merchant                              │
│       ↓                                                      │
│  Card Network (Visa/MC) → Authorization Request              │
│       ↓                                                      │
│  Issuing Bank checks balance → Approve/Decline               │
│       ↓                                                      │
│  Response back to merchant terminal                          │
│                                                              │
│  ⚡ Happens in milliseconds                                   │
│  💾 NO LEDGER BALANCE UPDATED                                │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Clearing & Settlement (Async)                                │
├──────────────────────────────────────────────────────────────┤
│  PSP processes authorizations from queue                     │
│       ↓                                                      │
│  Scheduled job: Build clearing files → upload to networks    │
│       ↓                                                      │
│  Networks acknowledge → PSP receives settlement files        │
│       ↓                                                      │
│  Queue → Ledger Workers                                      │
│       ↓                                                      │
│  ✅ LEDGER ENTRIES CREATED (20 per payment)                  │
│       ↓                                                      │
│  Merchant Payouts (T+1, T+2)                                 │
│                                                              │
│  ⏰ Processing constraint: minutes, not hours                │
│  🔑 Volume: 20x authorization, but async                     │
└──────────────────────────────────────────────────────────────┘
```

**Why this matters:**

1. **Ledger volume = 20x auth volume** - 10M payments creates 200M ledger entries, but not in real-time
2. **PSP controls the schedule** - Build outgoing clearing files, consume incoming settlement files
3. **Processing happens in minutes** - Must process batches quickly, not wait hours
4. **Real constraint is throughput** - Can you process incoming + outgoing files fast enough for payout SLA?

**Example:** 10M payments on Black Friday generates 200M ledger entries total, distributed across many accounts (merchants, platform revenue, network settlement, reserves, etc.). Focus on the hottest account - Platform Revenue/BIN:

**Outgoing (creating clearing files throughout the day):**
- 10M payments ÷ 50 BINs = **200K platform fee entries per BIN** across 18-hour business day
- Platform Revenue/BIN: 200K entries ÷ 64,800 sec = **3 tx/sec per account**
- Well under 160 tx/sec capacity - accounts stay cold

**Incoming (processing settlement file before payouts):**
- Single settlement file arrives from network (end of day)
- SLA: Process 200K settlement records per BIN within 1 hour
- 200K entries ÷ 3,600 sec = **55 entries/sec** = **~28 tx/sec per account**
- Well under 160 tx/sec ceiling - accounts stay cold

**Solution:** Both flows stay under capacity. Outgoing clearing distributes load throughout the day. Incoming settlement batches 200K entries, but 1-hour SLA keeps per-account rate at ~28 tx/sec, well within the 160 tx/sec ceiling. Domain sharding works.

This is why optimistic locking works beautifully for acquirers - the ledger is never in the critical authorization path.

## Revised Contention Analysis

With domain-driven sharding and queue-based processing, all accounts are cold:

| Account Type | Count | Payments/day each | Worker Rate | Capacity | Headroom |
|--------------|-------|-------------------|-------------|----------|----------|
| Platform Revenue/BIN | 50 | 200K | 3 payments/sec | ~160 tx/sec | 53x |
| Network Settlement/BIN | 50 | 200K | 3 payments/sec | ~160 tx/sec | 53x |
| Merchant Settlement | 10,000 | 1,000 | 0.015 payments/sec | ~160 tx/sec | 10,000x+ |

> **Note:** "Worker Rate" = controlled queue consumption rate (in payments/sec), NOT authorization volume. Peak Black Friday authorization doesn't impact ledger load.

**Key observations:**

1. **All accounts are cold** - Platform Revenue/BIN at 3 payments/sec has 53x headroom
2. **Queue-based processing eliminates peak concerns** - You control the rate, authorization spikes don't matter
3. **Real constraint is throughput** - Need 2+ workers to process 10M clearing entries in 6 hours for T+1 payouts
4. **Linear scaling is trivial** - Add workers, not accounts

## Infrastructure Scaling

With no hot accounts, throughput is limited only by total database capacity, not per-account contention.

### Scaling Calculation

From Part 1 benchmarks:
- **Low contention:** 440 tx/sec per instance (local, single DB)
- **Production (Aurora, same AZ):** ~420 tx/sec per instance (accounting for network latency)

**Infrastructure estimate:**

| Load | Instances | Total Capacity | Aurora Instance | Est. Cost/month |
|------|-----------|----------------|-----------------|-----------------|
| **Average** (3,086 tx/sec) | 8-10 | ~3,500-4,200 tx/sec | db.r6g.xlarge (4 vCPU, 32GB) | ~$2,500 |
| **Peak 5x** (15.4K tx/sec) | 36-40 | ~15,000-17,000 tx/sec | db.r6g.4xlarge (16 vCPU, 128GB) | ~$8,000 |
| **Black Friday 8x** (25K tx/sec) | 60-65 | ~25,000-27,000 tx/sec | db.r6g.8xlarge (32 vCPU, 256GB) | ~$15,000 |

**Linear scaling because:**
- Queue-based processing: No account exceeds 3 tx/sec (well under the ~160 tx/sec per-account capacity)
- Database bottleneck is total worker throughput, not row-level contention
- Add workers to meet payout SLAs, not to handle peak authorization volume
- Authorization spikes don't impact ledger - clearing files arrive async

### Scaling Curve

```
Throughput (tx/sec)
    ▲
25K │                                              ┌─── Black Friday 8x (65 instances)
    │                                         ┌────┘
20K │                                    ┌────┘
    │                               ┌────┘
15K │                          ┌────┘                Peak 5x (40 instances)
    │                     ┌────┘
10K │                ┌────┘
    │           ┌────┘
 5K │      ┌────┘
    │ ┌────┘
 3K │─┘                                              Average (8 instances)
    │
  0 └─────────────────────────────────────────────────────────►
    0        10        20        30        40        50        60   Instances

    Linear scaling - no account hotspots
```

Compare this to the naive approach with a single platform account:

```
Throughput (tx/sec)
    ▲
    │
200 │─────────────────────────────────────  Ceiling (hot account limit)
    │█████████████████████████████████████
160 │█████████████████████████████████████
    │█████████████████████████████████████
    │█████████████████████████████████████
    │
  0 └─────────────────────────────────────────────────►
    0        10        20        30        40       Instances

    Flat ceiling - adding instances doesn't help
```

## Scaling Data Storage

We've solved throughput and contention. But there's another scaling question: **How long until we run out of disk space?**

**The Storage Reality:**
- 10M payments → 100M ledger transactions → 200M ledger entries/day
- ~170 GB/day, ~5 TB/month, ~60 TB/year
- Aurora's 128TB limit: hit in ~1.5-2 years without archival

**Key insight:** After payout (T+1/T+2), ledger entries are rarely accessed. They exist for reconciliation and audit, not real-time queries.

**Simple strategy:**
1. **Archive monthly** to S3 Tables (or Parquet)
2. **Hot retention**: 90 days to 1 year depending on cost/value tradeoff
3. **Daily balance rollups**: Don't query archived entries for balances

**Costs at scale:**
- 90-day hot: `~15 TB` Aurora (`~$1,500/month` storage)
- Cold archive: S3 Tables (`~$0.02/GB/month`)

## Finding the Limit: How Many Entries Can a Single BIN Handle?

### What Each Payment Creates

Each payment creates 10 ledger transactions (20 entries total - 2 per transaction). Here's a $100 payment:

```
┌──────────────────────────────────────────────────────────────────┐
│ Payment: $100.00 from Customer to Merchant ABC                  │
│ Acquirer BIN: 123456 (EU region, EUR processing)                │
└──────────────────────────────────────────────────────────────────┘

Ledger Transaction 1-2: Customer Funding
  Entry 1: Debit  Customer_Funding_Source        $100.00
  Entry 2: Credit Payment_Clearing_Account       $100.00

Ledger Transaction 3-4: Gross Merchant Settlement
  Entry 3: Debit  Payment_Clearing_Account       $100.00
  Entry 4: Credit Merchant_ABC_Settlement        $100.00

Ledger Transaction 5-6: Platform Processing Fee (2.5%)
  Entry 5: Debit  Merchant_ABC_Settlement        $2.50
  Entry 6: Credit Platform_Revenue_BIN_123456    $2.50   ← BIN-scoped

Ledger Transaction 7-8: Interchange Fee to Issuer (1.8%)
  Entry 7: Debit  Payment_Clearing_Account       $1.80
  Entry 8: Credit Interchange_Payable_Account    $1.80

Ledger Transaction 9-10: Network Fee (Visa, 0.1%)
  Entry 9: Debit  Payment_Clearing_Account       $0.10
  Entry 10: Credit Network_Visa_Settlement_BIN_123456 $0.10   ← BIN-scoped

Ledger Transaction 11-12: Merchant Reserve Fund (1%)
  Entry 11: Debit  Merchant_ABC_Settlement       $1.00
  Entry 12: Credit Merchant_ABC_Reserve          $1.00

Ledger Transaction 13-14: Chargeback Reserve (0.5%)
  Entry 13: Debit  Merchant_ABC_Settlement       $0.50
  Entry 14: Credit Merchant_ABC_Chargeback_Reserve $0.50

Ledger Transaction 15-16: Currency Conversion Fee (if applicable, 1%)
  Entry 15: Debit  Merchant_ABC_Settlement       $1.00
  Entry 16: Credit Platform_Revenue_BIN_123456   $1.00   ← BIN-scoped

Ledger Transaction 17-18: Tax Withholding
  Entry 17: Debit  Merchant_ABC_Settlement       $0.50
  Entry 18: Credit Tax_Withholding_Account       $0.50

Ledger Transaction 19-20: Merchant Fee Account Rollup
  Entry 19: Debit  Merchant_ABC_Settlement       $4.50
  Entry 20: Credit Merchant_ABC_Fees             $4.50
```

Of these 20 entries, only **3 touch BIN-scoped accounts** (Platform Revenue × 2, Network Settlement × 1). The rest hit merchant-specific accounts (spread across 10,000+ merchants).

### The Limit Calculation

**Inputs:**
- 10M payments/day across 50 BINs = **200K payments per BIN per day**
- 3 BIN-scoped entries per payment = **600K entries per BIN per day**
- Queue processing rate: **~7 entries/sec per BIN** (600K ÷ 86,400 sec)
  > Note: Using 24-hour processing window since queue workers can process entries continuously, even outside the 18-hour payment window

**Capacity:**
- Single account ceiling: **~160 tx/sec** (from Part 1 benchmarks)
- Current rate: **~7 entries/sec** per BIN-scoped account
- **Headroom: ~23x**

**What if each payment created 40 entries?**
- 4 BIN-scoped entries per payment → 800K entries/BIN/day
- Queue rate: ~9 entries/sec per BIN
- Headroom: ~18x (still plenty)

**Conclusion:** With queue-based processing, you control the rate. The limit is total throughput, not per-account contention. Domain-driven sharding (by BIN) distributes the load, keeping all accounts cold.

## Conclusion

**Can optimistic locking handle 10 million transactions per day?**

**Yes, with domain-driven sharding.**

The naive approach (single platform account) fails at average load. But with proper account hierarchy:

| Account Type | Count | Contention | Strategy |
|--------------|-------|------------|----------|
| Platform Revenue/BIN | 50 | Cold (3 payments/sec) | Optimistic locking ✅ |
| Network Settlement/BIN | 50 | Cold (3 payments/sec) | Optimistic locking ✅ |
| Merchants | 10,000 | Frozen (0.015 payments/sec) | Optimistic locking ✅ |

**Key takeaways:**

1. **Use natural business boundaries** - Acquirer BINs (by region/currency/network), merchants
2. **Queue-based processing eliminates hot accounts** - All accounts are cold, you control the rate
3. **Hot keys are universal** - PostgreSQL, DynamoDB, any database—the solution is better data modeling
4. **Ledger != authorization** - Entries happen at clearing (async), not authorization (real-time)
5. **Real constraint is throughput** - Must process clearing files fast enough for merchant payouts (T+1/T+2)

**The system scales because:**
1. Load distributed across 10K+ merchant accounts + 50 BINs
2. Queue-based processing decouples authorization volume from ledger load
3. You control worker consumption rate - no peak surprises

**For acquirers, optimistic locking is perfect.** With 50 BINs and queue-based processing, all accounts stay cold. Scale by adding workers, not accounts.

---

## Further Reading

- [Stripe's Ledger: System for Tracking and Validating Money Movement](https://stripe.com/blog/ledger-stripe-system-for-tracking-and-validating-money-movement)
- [Design to Duty: Adyen Architecture Part 2](https://www.adyen.com/knowledge-hub/design-to-duty-adyen-architecture-part2)
- [Hot Partition Problem in Distributed Systems](https://aws.amazon.com/blogs/database/choosing-the-right-dynamodb-partition-key/)

---

## Series Navigation

- [**Part 1: Optimistic Locking in a Double-Entry Ledger**](/post/ledger_p1_optimistic_locking_real_time_ledger/)
- [**Part 2: Scaling for a Massive PSP**](/post/ledger_p2_scaling_double_entry_ledger_massive_psp/)
