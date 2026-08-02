# Exchequer Ledger

Exchequer is an operational subledger for recording balanced accounting facts, calculating balances, and grouping positions across assets. It provides ledger primitives to organizations without prescribing their chart of accounts or modeling their external customers, counterparties, payments, or markets.

## Ownership and boundaries

**Organization**:
A company that uses Exchequer, such as a broker-dealer, fintech, marketplace, payment service provider, or any company with treasury operations. An Organization owns its Ledgers and reusable Asset definitions.
_Avoid_: Tenant, customer tenant, account holder

**Operational Subledger**:
The accounting record maintained by Exchequer for operational money movement, entitlements, and positions. It complements rather than replaces an Organization's General Ledger.
_Avoid_: General Ledger, book of record for financial reporting

**External Party**:
A person or organization represented outside the Ledger and associated with Ledger Accounts through names, metadata, or External References. The Ledger has no Party or Account Holder entity.
_Avoid_: Ledger customer, Ledger user, Account Holder

**External Reference**:
An identifier or metadata value that links a Ledger resource to a concept owned by another system, such as a customer, broker, payment, pricing version, or bank account.

## Ledger structure

**Ledger**:
An Organization-owned boundary for atomic Transactions, balance calculation, querying, isolation, and scaling. A Ledger may contain many Assets, but every Account in a Transaction belongs to the same Ledger.
_Avoid_: Nested ledger, cross-ledger transaction

**Asset**:
An Organization-wide, fungible instrument measured by the Ledger, such as a fiat currency, share class, option series, or Usage Credit. An Asset has an immutable Exchequer identity and Minor Unit Exponent; symbols, codes, and external identifiers are attributes rather than identity.
_Avoid_: Currency, security, SKU when referring to every Asset

**Minor Unit Exponent**:
The immutable number of decimal places used to express an Asset in Minor Units. USD commonly uses `2`; an Asset supporting six decimal places uses `6`.
_Avoid_: Decimal precision, scale

**Minor Unit**:
The smallest quantity of an Asset recorded by the Ledger. Every Amount is an integer count of Minor Units.

**Amount**:
An integer quantity of one Asset expressed in its Minor Units. An Amount never combines or values multiple Assets.

**Ledger Account**:
An atomic balance-bearing bucket for one Asset, party, and accounting purpose within one Ledger. It is not necessarily a bank account, brokerage account, or External Party.
_Avoid_: Account Holder, bank account, wallet

**Normal Balance**:
The Debit or Credit orientation of an Account or Category. A debit-normal balance is Debits minus Credits; a credit-normal balance is Credits minus Debits.

**Ledger Account Category**:
A reusable rollup of Accounts and other Categories that reports a balance vector by Asset. Categories form an acyclic graph, may have multiple parents, and count each descendant Account once within a queried Category even when multiple paths reach it.
_Avoid_: Parent account, nested ledger

**Position**:
A derived balance for an Asset across one or more Ledger Accounts, commonly expressed by a Category. A Position does not include orders, tax lots, cost basis, execution venues, prices, or mark-to-market valuation.

**Omnibus Account**:
An ordinary debit-normal Ledger Account representing assets pooled for multiple External Parties. Corresponding customer or client balances are ordinary credit-normal liability Accounts, not nested ledgers.

## Transactions and entries

**Ledger Transaction**:
An atomic accounting event containing two or more Ledger Entries in one Ledger. For each Asset in the Transaction, total Debits equal total Credits; the event need not represent a physical money movement.
_Avoid_: Payment, transfer, trade when referring to every Transaction

**Ledger Entry**:
One Debit or Credit Amount on one Ledger Account within exactly one Ledger Transaction. An Entry has no lifecycle independent of its Transaction, and a Transaction may contain multiple Entries for the same Account.
_Avoid_: Posting, transaction entry

**Debit**:
One of the two canonical Entry directions. A Debit increases a debit-normal balance and decreases a credit-normal balance.

**Credit**:
One of the two canonical Entry directions. A Credit increases a credit-normal balance and decreases a debit-normal balance.

**Pending Transaction**:
A mutable Ledger Transaction that contributes to projected and availability calculations but is not yet an immutable accounting fact. Only its current state is part of the Ledger domain.
_Avoid_: Draft transaction

**Posted Transaction**:
An immutable Ledger Transaction accepted as an accounting fact. Posted describes internal accounting finality and does not mean an external payment, security trade, or bank transfer has settled.
_Avoid_: Settled transaction, finalized transaction

**Voided Transaction**:
A retained Pending Transaction that was abandoned and has no balance effect. A Posted Transaction cannot become Voided.
_Avoid_: Archived transaction, deleted transaction

**Effective Time**:
The time at which a Transaction applies to balance and reporting calculations. A future-effective Transaction is excluded from current balances until its Effective Time, even when already Posted.
_Avoid_: Settlement time

**Posted Time**:
The time at which a Pending Transaction became immutable as a Posted Transaction. It records internal accounting finality, not external settlement.

**Created Time**:
The time at which a Ledger resource was first created.

**Updated Time**:
The time at which a mutable Ledger resource was most recently changed.
_Avoid_: Recorded time

## Balance views

**Balance**:
A rebuildable projection of Ledger Entries for one Account or Category, one Asset, and an as-of time. Ledger Entries are the accounting source of truth.

**Posted Balance**:
The balance calculated from effective Posted Transactions only.

**Pending Balance**:
The projected balance calculated from effective Posted and Pending Transactions.
_Avoid_: Pending-only balance

**Available Balance**:
The conservative spendable projection that includes effective Posted increases and both Posted and Pending decreases, while excluding Pending increases.
_Avoid_: Posted balance, cash balance

**Negative Balance**:
A valid Balance that records an overdraft, short position, issuer position, or other accounting fact. The Ledger does not reject a Transaction merely because it would make a Balance negative; preventative policy belongs to an upstream workflow.
_Avoid_: Invalid balance, insufficient-funds error

## Operational ledger concepts

**Ledger Account Statement**:
An immutable, versioned snapshot of an Account for a defined period. It copies the included Posted and Pending Entry data and all three Balance views so the statement remains reproducible after Pending Transactions change.
_Avoid_: Live account report

**Ledger Account Settlement**:
A netting operation that selects previously unsettled Posted Entries from one Account and links them to an offsetting Ledger Transaction between that Account and a contra Account. Entries omitted by an earlier cutoff remain eligible, each Entry belongs to at most one active or Posted Settlement, and voiding a Pending Settlement releases its Entries.
_Avoid_: Bank settlement, payment settlement

**Settlement Cutoff**:
The Effective Time upper bound used to select eligible Posted Entries for a Ledger Account Settlement. Entries may instead be selected explicitly while drafting the Settlement.

**Balance Monitor**:
An alerting rule evaluated against a Ledger Account balance. It emits when its condition crosses from false to true and rearms only after the condition becomes false; it never blocks a Transaction.
_Avoid_: Balance limit, transaction control

**Closed Account**:
A Ledger Account that remains queryable with its complete history and balances but cannot receive new Entries. Only an Account that has never been used may be deleted.
_Avoid_: Deleted account, archived account

## Usage credits

**Usage**:
A quantity of product consumption measured outside the Ledger, such as tokens, images, or compute. Usage is input to Rating and is not itself a Ledger Entry.

**Rating**:
The external process that converts Usage into a final Amount of Usage Credits using a price or rate. The Ledger records the resulting balanced Transaction and may retain an External Reference to the pricing version.
_Avoid_: Ledger pricing, Ledger metering

**Usage Credit**:
A custom Asset representing a prepaid service entitlement and the unit consumed after Rating. Plan allocations, purchased credits, expiry groups, and consumption are represented with ordinary Ledger Accounts and Transactions.
_Avoid_: Raw usage, fiat balance

**Issuance Account**:
An ordinary internal Ledger Account used as the balancing side when an Organization creates Usage Credits. Issuance is not constrained by a reserve balance in the Ledger.
_Avoid_: Credit mint, reserve account

## Concepts outside the Ledger

**External Settlement**:
The completion state of a payment, bank transfer, or security trade in the system responsible for that activity. It may be linked to Ledger resources by External Reference but is not a Ledger Transaction status or timestamp.

**Valuation**:
The external conversion of an Asset Amount into another Asset or reporting currency using a market price or exchange rate. The Ledger stores balanced Amounts by Asset and does not calculate valuation, foreign-exchange rates, or mark-to-market positions.

**Virtual Account**:
A bank-issued addressing or reconciliation mechanism owned by a payments system. An internal virtual balance is modeled as an ordinary Ledger Account; Virtual Account is not a Ledger primitive.

## Flagged ambiguities

- **Posted versus settled**: Posted means the Ledger Transaction is immutable; settled refers only to an external operational lifecycle.
- **Account versus Account Holder**: Ledger Account means a balance-bearing bucket; the person or organization associated with it is an External Party.
- **Ledger settlement versus external settlement**: Ledger Account Settlement nets eligible Ledger Entries; External Settlement completes an activity in another system.
- **Balance versus valuation**: Balance is an Asset Amount derived from Entries; Valuation applies an external price or rate.
- **Credits**: Credit is an Entry direction; Usage Credit is an Asset. Use the full term when referring to the entitlement.
- **Pending Balance**: Pending Balance includes Posted and Pending Transactions; it is not the delta from Pending Transactions alone.
- **Correction or reversal**: Neither is a special Ledger primitive. Record an ordinary balanced Transaction, optionally link it to the original with an External Reference, and leave the Posted original unchanged.

## Example dialogue

> **Domain expert:** Broker A holds 10 AAPL for us and Broker B holds 15 AAPL. Create one AAPL Ledger Account for each custody purpose and place both in the AAPL Position Category.
>
> **Developer:** So the Category reports an AAPL Position of 25 shares, while each Account retains its own balance. The brokers remain External Parties referenced in Account metadata.
>
> **Domain expert:** Correct. If we buy AAPL for USD, record one balanced set of USD Entries and one balanced set of AAPL Entries in the same Ledger Transaction. Pricing and execution venue stay outside the Ledger.
>
> **Developer:** When the Transaction is Posted, it becomes immutable, but that does not claim the broker trade has externally settled.
>
> **Domain expert:** Exactly. Its Effective Time controls when it appears in balances, and external settlement can be linked later through an External Reference.
