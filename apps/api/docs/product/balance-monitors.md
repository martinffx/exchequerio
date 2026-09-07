# Balance monitors

A Balance Monitor observes one Ledger Account. It emits a webhook when the complete condition
changes from false to true during a committed balance change. It stays quiet while the condition
remains true and can emit again after becoming false. Monitoring never rejects a Transaction based
on its Amount or resulting Balance.

## API contract

Use the existing Account-scoped `balance-monitors` collection and item endpoints. Ledger and Account scope comes
from the URL; Organization scope comes from authentication. Creation and updates accept:

```json
{
	"description": "Low available balance",
	"alertCondition": {
		"mode": "all",
		"conditions": [
			{ "balanceType": "availableBalance", "operator": "<", "value": "10000" },
			{ "balanceType": "posted", "operator": ">=", "value": "0" }
		]
	},
	"webhook": {
		"url": "https://example.com/hooks/balance",
		"bearerToken": "caller-provided-secret"
	}
}
```

`mode` is `all` or `any`; the flat `conditions` list must contain at least one comparison.
`balanceType` is `posted`, `pending`, or `availableBalance`; `operator` is `=`, `!=`, `<`, `<=`, `>`,
or `>=`. Values are canonical decimal strings in signed 64-bit Minor Units, matching the Asset amount contract. Pending Balance includes Posted and
Pending Transactions. Optional metadata follows the Ledger API's string-map metadata contract.

Creation establishes the current balance as the baseline and sends no initial alert, even when
its condition is already true. Editing a rule establishes a new baseline without sending an alert.
Responses expose the saved configuration and `lockVersion`, but never the bearer token. An update
may omit `webhook.bearerToken` to retain the existing token.

Each configuration version is immutable for balance changes that already occurred. A queued change
uses the rule, URL, and token that applied when it was captured, even after a later edit. Deleting a
monitor stops future monitoring; evaluations and deliveries for earlier changes finish normally.

## Webhook contract

The worker sends JSON using HTTPS POST with `Authorization: Bearer <token>`. Destinations must be
public HTTPS endpoints. Delivery validates and pins resolved addresses, rejects unsafe addresses,
and does not follow redirects. Each request has a 10-second deadline including DNS resolution.
Any 2xx response succeeds; other responses and transport failures retry.

The payload contains `type: "balance_monitor.triggered"`, a stable `eventId`, `monitorId`,
`monitorVersion`, `organizationId`, `ledgerId`, `accountId`, `accountVersion`, `transactionId`,
`occurredAt`, `assetId`, `assetCode`, `minorUnitExponent`, `before`, `after`, and `alertCondition`. Both balance snapshots contain
`posted`, `pending`, and `availableBalance` decimal-string Amounts. Asset details are captured with the
balance event; renaming an Asset later does not change a queued webhook. `occurredAt` is the balance change's
recorded timestamp, not the delivery time.

The event ID combines the original Account change ID and monitor ID. Retries retain that ID.
Receivers must deduplicate it because a successful HTTP request can be retried if its acknowledgement
is lost. Webhooks can arrive out of order; `accountVersion` identifies their Account ordering.
There is no public alert-history API.

## Processing and durability

The ledger write saves an Account's before/after snapshot in a PostgreSQL outbox in the same
transaction as its balance update. Accounts without monitors and changes with identical snapshots
do not create outbox events. This adds database writes to monitored balance changes; it does not
perform webhook requests inside the ledger transaction.

A separate worker claims bounded outbox batches with expiring leases and publishes self-contained
jobs through effect-mq 0.7.0 to the existing Valkey service. It deletes an outbox event only after
publishing all its monitor jobs successfully. Stable job keys make repeated publication safe.
PostgreSQL LISTEN/NOTIFY wakes the relay, with startup/reconnect and periodic recovery scans for
missed notifications. Notifications are wakeups; PostgreSQL holds the durable work until handoff.

Each job evaluates its own before/after snapshots, so evaluation does not require Account ordering.
Matching jobs deliver the webhook with at most 12 total attempts and exponential delays starting at
30 seconds with a factor of two. Exhausted jobs remain failed for operator inspection and replay.
Completed and cancelled jobs expire after 24 hours; failed jobs expire after 7 days. Unfinished jobs
are not removed by these retention limits. Inspect and replay failures before their retention expires.

Valkey uses a durable volume, AOF persistence with `appendfsync everysec`, and `noeviction`.
After a confirmed Valkey handoff, PostgreSQL no longer retains that event. This design explicitly
accepts roughly one second of handed-off work loss if Valkey crashes before its AOF is flushed;
it does not guarantee recovery from loss of the Valkey volume. A stopped worker can resume work
that remains in PostgreSQL or durable Valkey storage.

## Running and operating

Generate a 32-byte base64 encryption key once:

```bash
openssl rand -base64 32
```

Store it as `BALANCE_MONITOR_ENCRYPTION_KEY` in `apps/api/.env` for local development and in the
secret environment of both the API and worker in deployment. No default key is supplied. Monitor
writes require a valid key, and the worker validates its key at startup. Tokens are encrypted in
PostgreSQL and queued payloads. Keep the same key until all configurations and jobs encrypted with it
are retired. There is no built-in key rotation or automatic re-encryption; replacing the key makes
existing ciphertext unreadable.

```bash
# Start infrastructure, API, and the monitor worker
pnpm run dev:api

# Run only the worker against configured infrastructure
pnpm --filter=@exchequerio/api dev:worker

# Build the API, worker, and operator CLI into the existing API image entrypoints
pnpm --filter=@exchequerio/api build
pnpm --filter=@exchequerio/api start:worker

# Inspect or replay one retained failed job (output excludes payload secrets)
pnpm --filter=@exchequerio/api monitor:jobs inspect <jobId>
pnpm --filter=@exchequerio/api monitor:jobs replay <jobId>
```

The Compose `api` profile starts both API and worker from the same image. Export
`BALANCE_MONITOR_ENCRYPTION_KEY` in the invoking shell, or supply the environment file explicitly:

```bash
docker-compose --env-file apps/api/.env --profile api up -d --build
```

Run database migrations before starting the new API and worker. The unreleased monitor migration
now follows the UUID and Asset cutovers. Use a fresh development database to replay this history;
there is no compatibility path for the earlier branch-only monitor migration or queue payloads. The monitor migration refuses to
proceed when legacy monitor rows exist because those rows did not persist the new rule and webhook
configuration. Export the old records, explicitly remove them with operator authorization, rerun the
migration, and recreate monitors with complete configuration. Do not silently discard records or
invent conditions during migration.
