# When Do You Actually Need TigerBeetle?

**Part 3: The hot account problem is rarer than you think**

---

## Introduction

In [Part 1](./optimistic-locking.md), we built a double-entry ledger with optimistic locking. In [Part 2](./scaling-psp-ledger.md), we showed it handles 200M ledger transactions per day using domain-driven sharding.

The key insight from Part 2: **with proper account hierarchy, there are no hot accounts.**

This raises an obvious question: if hot accounts are the problem TigerBeetle solves, and good schema design eliminates hot accounts, when would you actually need TigerBeetle?

Let's look at real numbers from the biggest payment processors.

> **Terminology (from Part 2):** A payment creates multiple ledger transactions (debits + credits), each containing 2 entries. "50 events per payment" = 25 transactions × 2 entries.

---

## What TigerBeetle Actually Solves

TigerBeetle is purpose-built for one thing: **extreme write contention on a single account.**

Traditional databases hold row locks across network roundtrips. When thousands of transactions hit the same account simultaneously, you get lock contention, retry storms, and throughput collapse. TigerBeetle eliminates this by:

1. **Single-threaded execution** - No lock coordination overhead
2. **Debit/credit as primitives** - All logic inside the database
3. **Aggressive batching** - Up to 8,190 transfers per batch, consensus cost paid once

The result: ~400,000 TPS on a single account, where PostgreSQL caps at ~160-200 TPS under extreme contention (see Part 1 benchmarks).

Impressive. But do you have a single account handling 400,000 TPS?

---

## Real Numbers: Stripe, Square, and Adyen

Let's look at actual production volumes:

| Company | Payments/Day | Ledger Events/Day | Annual TPV |
|---------|--------------|-------------------|------------|
| **Stripe** | 50-100M | ~5 billion | $1.4T |
| **Adyen** | ~86M | ~4.3B | €1.3T |
| **Square** | ~14M | ~14M | $228B |

Stripe's internal ledger logs approximately 5 billion money-movement events daily—that's roughly 50-100 ledger events per payment depending on complexity. At their BFCM 2024 peak, they hit 137,000 transactions per minute.

**Let's do the math for Stripe at 5B ledger events/day:**

**Naive design (single platform account):**
```
5B events / 86,400 seconds = 57,870 tx/sec average
Peak (3x): ~174,000 tx/sec on ONE account
```
That would be catastrophically hot. No database handles that on a single row.

**Domain-driven design (sharded by BIN, merchant, event type):**

Stripe likely has 3,000+ BINs and 500,000+ merchants. With proper sharding:
```
Platform Revenue: 5B / 3,000 BINs = 1.67M events/BIN/day = 19 tx/sec per BIN account
Merchant accounts: 5B / 500,000 = 10,000/day per merchant = 0.1 tx/sec per account
```

At 19 tx/sec per BIN account, that's warm but manageable. Add a second dimension (BIN + event type, or BIN + currency) and you're back to single-digit tx/sec per account.

**The pattern holds across all three:**

| Company | If Single Account | With Domain Sharding | Per-Account Load |
|---------|-------------------|----------------------|------------------|
| Stripe | 57,870 tx/sec 🔴 | 3,000+ BIN accounts | ~19 tx/sec 🟡 |
| Adyen | ~50,000 tx/sec 🔴 | Enterprise-sharded | <5 tx/sec 🟢 |
| Square | 162 tx/sec 🟡 | 4M seller accounts | 0.003 tx/sec 🟢 |

**Scale helps distribution.** Bigger companies have more accounts to spread load across. The architecture gets *easier* at Stripe scale, not harder.

---

## The Hot Account Checklist

Before reaching for TigerBeetle, ask yourself:

### 1. Can you shard by a natural business boundary?

| Domain | Natural Shard Key | Result |
|--------|-------------------|--------|
| PSP/Payments | BIN, Client, Merchant | No hot accounts |
| E-commerce | Seller, Category, Region | No hot accounts |
| Banking | Branch, Product, Customer Segment | No hot accounts |
| SaaS Billing | Customer, Plan, Region | No hot accounts |

If yes → PostgreSQL with domain-driven sharding.

### 2. Is the "hot" account actually a design smell?

Common mistakes that create artificial hot accounts:

```
❌ Single "Platform Revenue" account
✅ Platform Revenue per BIN (or per Client, per Region)

❌ Single "Visa Settlement" account
✅ Visa Settlement per BIN (networks settle daily per BIN anyway)

❌ Single "Tax Withholding" account
✅ Tax Withholding per jurisdiction
```

If your schema has a single account that "every transaction touches," that's not a database problem—it's a data modeling problem.

### 3. What's the actual contention?

From our benchmarks:

| tx/sec per account | Retry Rate | Status |
|--------------------|------------|--------|
| < 5 | < 1% | 🟢 No problem |
| 5-10 | 2-5% | 🟢 Fine |
| 10-15 | 5-10% | 🟡 Watch it |
| 15-50 | 10-30% | 🟡 Consider sharding |
| 50+ | 30%+ | 🔴 Shard or change strategy |

Most accounts in a well-designed system sit at < 1 tx/sec.

---

## When You Genuinely Can't Shard

There are legitimate cases where a single account *must* handle extreme throughput:

### 1. Cryptocurrency Hot Wallets

A Bitcoin address is a single account. You can't shard `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` across multiple addresses—it's one balance on the blockchain.

Crypto exchanges have exactly one hot wallet per currency. If you're Binance processing 1M+ withdrawals/day from a single ETH wallet, that's a genuine hot account.

### 2. Real-Time Auction/Bidding Pools

If you need to track a single pool balance where thousands of bidders compete simultaneously:
- Stock exchange order book settlement
- Ad exchange real-time bidding
- Gaming tournament prize pools

The pool can't be sharded because everyone needs to see the same balance atomically.

### 3. Central Bank / FedNow Style Settlement

Single settlement account for an entire payment rail where all participants settle against one counterparty in real-time.

---

## The Hidden Complexity Tax

Even if you have a genuine hot account, TigerBeetle introduces costs:

### 1. You Still Need PostgreSQL

TigerBeetle stores:
- Account ID (128-bit)
- Debit/credit amounts
- User data (128-bit opaque field)

It does *not* store:
- Transaction descriptions
- Customer/merchant details
- Order references
- Audit context
- Any queryable metadata

Every TigerBeetle transfer needs a companion record in PostgreSQL. You're running two databases, not one.

### 2. No ACID Across Both

```typescript
await tigerbeetle.createTransfer(transfer); // ✅ Balance moved
await postgres.insert(metadata);            // ❌ Fails - network blip
// Now what?
```

TigerBeetle transfers are immutable. No rollback. Your options:
- Reversing entries (messy audit trail)
- Retry forever (what if it's bad data?)
- Manual reconciliation (at 200M tx/day? good luck)

With PostgreSQL alone: one transaction, full ACID, done.

### 3. Storage Limits

TigerBeetle uses ~400 bytes per transfer. Current tested limit is 16 TiB on ext4.

```
16 TiB / 400 bytes = ~40 billion transfers
At 200M tx/day: ~200 days of storage
```

For a financial system with 7-year retention requirements, you're building archival pipelines. There's no `pg_dump` equivalent—you'll roll your own.

PostgreSQL on Aurora: 128 TiB limit, automatic growth, point-in-time recovery built in.

### 4. Single-Core by Design

TigerBeetle uses one core, one leader node. Adding replicas increases reliability, not throughput.

At 400K TPS you're fine. But if you need more, you're sharding at the application level—at which point, why not just shard PostgreSQL?

---

## The Decision Framework

```
                    ┌─────────────────────────────┐
                    │ Do you have > 50 tx/sec     │
                    │ on a SINGLE account?        │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │            No               │
                    │                             │
                    │  PostgreSQL + optimistic    │
                    │  locking. You're done.      │
                    └─────────────────────────────┘
                                  │
                                 Yes
                                  │
                    ┌─────────────▼───────────────┐
                    │ Can you shard by a natural  │
                    │ business boundary?          │
                    │ (BIN, merchant, region...)  │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │            Yes              │
                    │                             │
                    │  Shard the account.         │
                    │  PostgreSQL. You're done.   │
                    └─────────────────────────────┘
                                  │
                                  No
                                  │
                    ┌─────────────▼───────────────┐
                    │ Is this actually a single   │
                    │ identity that can't split?  │
                    │ (Crypto wallet, central     │
                    │  settlement, auction pool)  │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │            Yes              │
                    │                             │
                    │  Consider TigerBeetle.      │
                    │  Accept the complexity.     │
                    └─────────────────────────────┘
                                  │
                                  No
                                  │
                    ┌─────────────▼───────────────┐
                    │  You have a schema design   │
                    │  problem, not a database    │
                    │  problem. Fix the schema.   │
                    └─────────────────────────────┘
```

---

## What About Settlement File Processing?

A common question: "What about ingesting a 1M record settlement file?"

If you're processing message-per-transaction through a queue:
- 10 workers at 440 tx/sec = ~38 minutes for 1M records
- TigerBeetle with 8K batching = ~2-3 seconds

That's a real difference. But consider:

1. **Is 38 minutes acceptable?** For overnight batch settlement, probably yes.

2. **Can you batch at the queue level?**
```typescript
// Instead of 1M messages → 1M writes
// Aggregate first → one write per account
const batch = await queue.drain('settlement', { max: 100000 });
const byAccount = groupBy(batch, 'accountId');
await postgres.bulkUpdate(byAccount);
// 1M records → ~30K account updates → 2-3 minutes
```

3. **Do you need the metadata transactionally?** With TigerBeetle, you're coordinating two databases. With PostgreSQL, it's one transaction.

---

## Conclusion

TigerBeetle is genuinely well-engineered. Jepsen-validated, resilient to disk corruption, thoughtfully designed for its problem domain.

But that domain is narrow: **single accounts handling extreme concurrent writes that cannot be sharded.**

For PSPs, payment processors, marketplaces, and most fintech:
- Domain-driven sharding eliminates hot accounts
- PostgreSQL with optimistic locking handles the load
- Single-database ACID beats distributed coordination complexity
- Managed PostgreSQL (RDS, Aurora) solves operations

The hot account problem is real. It's just rarer than the marketing suggests.

---

## Summary

| Scenario | Scale | Solution |
|----------|-------|----------|
| PSP with proper account hierarchy | 200M tx/day | PostgreSQL ✅ |
| Square (14M payments/day, 4M sellers) | 14M tx/day | PostgreSQL ✅ |
| Adyen (86M payments/day, 4.3B events) | 4.3B tx/day | PostgreSQL ✅ |
| Stripe (5B ledger events/day, 3K+ BINs) | 5B tx/day | PostgreSQL + sharding ✅ |
| E-commerce marketplace | Varies | PostgreSQL ✅ |
| Crypto exchange hot wallet | 1M+ tx/day to ONE address | TigerBeetle (maybe) |
| Central settlement counterparty | All participants → one account | TigerBeetle (maybe) |
| Real-time auction pool | Thousands competing for one balance | TigerBeetle (maybe) |

**If you can shard by a natural business boundary, you don't need TigerBeetle.**

Most of the time, you can.

---

## Further Reading

- [Part 1: Optimistic Locking in a Real-Time Double-Entry Ledger](./optimistic-locking.md)
- [Part 2: Scaling to 10 Million Transactions Per Day](./scaling-psp-ledger.md)
- [TigerBeetle Documentation](https://docs.tigerbeetle.com/)
- [Jepsen Analysis: TigerBeetle 0.16.11](https://jepsen.io/analyses/tigerbeetle-0.16.11)
