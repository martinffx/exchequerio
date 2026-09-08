# Category balances

Read a Category's current balances by Asset:

```http
GET /api/ledgers/:ledgerId/accounts/categories/:categoryId/balances
Authorization: Bearer <token>
```

The caller needs `ledger:account:category:read` permission. The Ledger and Category must belong to the caller's Organization.

The response groups the three balance views under each Asset:

```json
{
	"categoryId": "lac_00000000000000000000000001",
	"normalBalance": "debit",
	"assets": [
		{
			"assetId": "ast_00000000000000000000000001",
			"assetCode": "USD",
			"minorUnitExponent": 2,
			"balances": [
				{ "balanceType": "pending", "amount": "120", "credits": "30", "debits": "150" },
				{ "balanceType": "posted", "amount": "80", "credits": "20", "debits": "100" },
				{ "balanceType": "availableBalance", "amount": "70", "credits": "30", "debits": "100" }
			]
		}
	]
}
```

Amounts and counters are signed 64-bit integer Minor Units encoded as decimal strings. Assets are ordered by immutable Asset ID. The Asset Code is its current label; renaming it does not change which balances belong together.

## Membership and timing

A Category includes the full current balances of all its descendant Accounts. An Account contributes once even when several paths reach it. Linking an Account includes its existing balance; unlinking removes it only when no other descendant path remains.

Each request returns a consistent snapshot. Membership and balance changes committed after that snapshot appear on the next read. Concurrent Account creation or linking is normal and does not invalidate a response. Effective Time does not delay live balance effects.

An empty Category returns `assets: []`. An Asset remains in the response when its descendant Accounts have zero balances. Category list and detail responses contain metadata; request this endpoint when you need balances.

## Balance views

- **Posted Balance** includes Posted Transactions.
- **Pending Balance** includes Posted and Pending Transactions.
- **Available Balance** includes Posted increases and both Posted and Pending decreases, excluding Pending increases.

All three views use the queried Category's Normal Balance. Debit-normal Categories calculate Debits minus Credits; credit-normal Categories calculate Credits minus Debits. Available Balance follows that same Category orientation, even if descendant Accounts have different orientations.

## Errors and limits

Missing or inaccessible Ledgers and Categories return `404`. If any resulting amount or counter exceeds the signed 64-bit range, the endpoint returns a non-retryable `409` without a partial balance vector. Database unavailability returns `503`.

This endpoint provides current balances, without historical queries, filtering, or pagination. Query cost grows with Category membership, so measure the effect of frequent reads for large Categories.

Category linking rejects cycles visible when it checks the graph. Concurrent links can still race; preventing those races is deferred. Balance reads terminate safely on existing cycles and count every reachable Account once.
