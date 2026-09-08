# Assets and amounts

Create an Asset once per Organization and reuse it across its Ledgers. Each Ledger Account is
permanently assigned to one Asset. Asset definitions carry an immutable ID and Minor Unit Exponent;
the Ledger records integer Minor Units and performs no pricing or valuation.

## Create and manage Assets

`POST /api/assets` requires `code`, `name`, and `minorUnitExponent`:

```json
{
	"code": "USD",
	"name": "US Dollar",
	"minorUnitExponent": 2
}
```

The response includes a generated `ast_…` ID and `created`/`updated` timestamps. Asset IDs and
references use native PostgreSQL UUID storage while the API retains TypeIDs. Description and
string-valued metadata are optional. Exponents range from 0 through 18 and have no default.
Codes contain 1–64 ASCII letters, digits, `.`, `_`, `:`, or `-`; input is normalized to uppercase.
Codes are unique within the authenticated Organization. No built-in currency catalog is provided.

| Operation                         | Route                         | Permission     |
| --------------------------------- | ----------------------------- | -------------- |
| List or filter by exact code      | `GET /api/assets?code=USD`    | `asset:read`   |
| Create                            | `POST /api/assets`            | `asset:write`  |
| Get                               | `GET /api/assets/:assetId`    | `asset:read`   |
| Replace mutable attributes        | `PUT /api/assets/:assetId`    | `asset:write`  |
| Delete an unreferenced definition | `DELETE /api/assets/:assetId` | `asset:delete` |

Lists use `offset` (default 0, maximum 10,000) and `limit` (default 20, maximum 100), returning an
array ordered by ID. PUT requires code and name; omitted description and metadata are cleared.
ID, Organization, and exponent cannot change. A referenced Asset cannot be deleted. Renaming a code
releases the old code for reuse; old codes are not aliases.

## Identify an Asset in accounting requests

Account creation and each Transaction Entry require exactly one of `assetId` or `assetCode`.
Codes resolve within the authenticated Organization, and an Entry must match its Account's Asset.
For example, these two selectors identify the same Asset after creating USD:

```json
{ "assetCode": "usd" }
```

```json
{ "assetId": "ast_01m1yvm1wrf6cvn9yqs3xc54zt" }
```

Use the actual ID returned by creation. A Transaction may contain multiple Assets, but each Asset's
Debits must equal its Credits independently. Settlement accounts must share one Asset.

Accounting responses expose `assetId`, the current `assetCode`, and `minorUnitExponent`, alongside
string quantities. Renaming a code changes its display on historical responses without changing
the Asset recorded in accounting. An existing idempotency key replays the original operation before
any new code lookup; internal retries retain the initially resolved IDs.

## Exact quantities

All accounting quantities are canonical decimal integer strings in JSON. With exponent 2,
`"10000"` means 100 whole units. Entry amounts are positive and at most `"9223372036854775807"`.
Signed quantities range from `"-9223372036854775808"` to `"9223372036854775807"`.

JSON numbers, fractions, exponent notation, whitespace, leading plus signs, redundant leading zeros,
and negative zero are rejected. Counts, timestamps, lock versions, and exponents retain their
existing representations. Balance-valued Monitor conditions use signed amount strings; timestamp
conditions remain numeric. Monitor evaluation is not implemented.

Every stored Account projection, including gross Debit and Credit totals, must fit the signed
64-bit range. Exact intermediate totals may exceed it, but a final overflow returns `409` and
rolls back the accounting mutation. Invalid input amounts, mismatched Assets, or unbalanced
Transactions return `400`; unavailable scoped Assets return `404`.

## Availability and cutover

Category metadata responses omit `balances`; current Category balances are available from
`GET /api/ledgers/:ledgerId/accounts/categories/:categoryId/balances`, grouped by Asset. Monitor
`balances` and Statement `startingBalances`/`endingBalances` remain omitted until their calculations
are implemented. These responses do not report fabricated zero balances.
Statement Asset details come from the associated Account within the authenticated Organization.

The Asset migration requires empty currency-bearing accounting tables. It locks and checks those
tables, then fails without changing existing data when records remain. Use a fresh development
database for this clean API cutover. There is no automatic currency mapping or legacy API adapter.

OpenAPI is generated from TypeBox route schemas and route metadata. Those schemas are the source of
truth for the request and response contracts.
