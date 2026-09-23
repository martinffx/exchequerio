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
		"signingSecret": "whsec_<base64-encoded 32-byte random key>"
	}
}
```

`mode` is `all` or `any`; the flat `conditions` list must contain at least one comparison.
`balanceType` is `posted`, `pending`, or `availableBalance`; `operator` is `=`, `!=`, `<`, `<=`, `>`,
or `>=`. Values are canonical decimal strings in signed 64-bit Minor Units, matching the Asset amount contract. Pending Balance includes Posted and
Pending Transactions. Optional metadata follows the Ledger API's string-map metadata contract.

Creation establishes the current balance as the baseline and sends no initial alert, even when
its condition is already true. Editing a rule establishes a new baseline without sending an alert.
Responses expose the saved configuration and `lockVersion`, but never the signing secret. An update
may omit `webhook.signingSecret` to retain the existing signing secret.

Each configuration version is immutable for balance changes that already occurred. A queued change
uses the rule, URL, and signing secret that applied when it was captured, even after a later edit. Deleting a
monitor stops future monitoring; evaluations and deliveries for earlier changes finish normally.

## Webhook contract

The worker sends signed JSON using HTTPS POST. Destinations must be
public HTTPS endpoints. Delivery validates and pins resolved addresses, rejects unsafe addresses,
and does not follow redirects. Each request has a 10-second deadline including DNS resolution.
Any 2xx response succeeds. Network failures (including DNS), timeouts, HTTP 408, 429, and 5xx
responses retry. Other HTTP responses, unsafe destinations, and invalid signing credentials fail
immediately and remain available for operator inspection and replay.

The caller supplies a signing secret when creating a monitor. Use `whsec_` followed by the canonical
base64 encoding of 32 random bytes; the API rejects other formats. Generate one with:

```bash
printf 'whsec_'; openssl rand -base64 32
```

Delivery follows the [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
HMAC-SHA256 convention. Headers are:

- `webhook-id`: the stable event ID, also present in the JSON body.
- `webhook-timestamp`: the attempt time in integer Unix seconds; refreshed on every retry.
- `webhook-signature`: `v1,` followed by the base64-encoded HMAC-SHA256 signature.

The signed bytes are `webhook-id.webhook-timestamp.raw-body`. Decode the secret after removing
`whsec_` to obtain the HMAC key. The receiver must verify the signature against the exact raw request
body with a constant-time comparison before processing it, accept attempt timestamps only within
five minutes of its clock, and deduplicate the event ID. Changing the ID, timestamp, or body invalidates
the signature. No bearer Authorization header is sent.

Updating `webhook.signingSecret` affects future captured alerts only. Receivers must retain old
verification secrets while historical jobs can still be delivered or replayed. Signing secrets are
separate from the API and worker's storage encryption key.

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

Alerts are best effort. Inside the accounting transaction, the repository captures before/after
balances and the applicable monitor configuration while holding the Account locks. After commit,
the service hands these self-contained jobs to an application-owned background task and continues
without waiting for Valkey. Publication allows four retries after the first attempt, with exponential
backoff starting at 100 ms and ±20% jitter. Each attempt has a five-second timeout; the full retry
sequence takes at most approximately 27 seconds. Retries reuse the same payloads and job IDs, so
partial success or a lost acknowledgement does not duplicate jobs. This covers ordinary and Settlement Transactions.
Accounts without monitors, unchanged balances, rollbacks, and completed accounting replays produce
no new jobs. Webhook requests run only in the delivery worker.

There is no PostgreSQL outbox or relay. A crash between accounting commit and enqueue can lose an
alert, and publication is not recovered automatically after retries are exhausted. Exhausted enqueue failures and timeouts are logged
and do not retry or roll back accounting. The service continues its existing idempotency completion
or Settlement finalization. Those operations retain their own failure behavior.

`monitor_enqueue_failed` logs Transaction, Account, and job IDs with a sanitized reason and attempt count. Its
`unconfirmed` outcome means Valkey may have accepted some or all jobs despite the missing response.
`monitor_delivery_failed` identifies the event, monitor, job, attempt, failure category, and HTTP
status when available. Stored delivery errors retain the same safe category and status. Neither log includes
credentials, webhook URLs, payloads, or raw errors. Use these events for operational alerts; an
abrupt process or host failure can occur before any log is written.

SIGTERM and SIGINT stop the API from accepting work, await active requests, then drain tracked
background enqueue tasks before disposing Valkey and the runtime. The API Compose service allows
60 seconds for shutdown. Other deployments must allow enough time for active requests and the
remaining enqueue retries. Forced termination and host failure cannot be drained.

Each job evaluates its own before/after snapshots, so evaluation does not require Account ordering.
Matching jobs deliver the webhook with at most 12 total attempts and exponential delays starting at
30 seconds with a factor of two. Exhausted jobs remain failed for operator inspection and replay.
Completed and cancelled jobs expire after 24 hours; failed jobs expire after 7 days. Unfinished jobs
are not removed by these retention limits. Inspect and replay failures before their retention expires.

Valkey uses a durable volume, AOF persistence with `appendfsync everysec`, and `noeviction`.
This design accepts roughly one second of queued work loss if Valkey crashes before its AOF is
flushed; it does not guarantee recovery from loss of the Valkey volume. A stopped delivery worker
can resume jobs retained in Valkey.

## Running and operating

Generate a 32-byte base64 encryption key once:

```bash
openssl rand -base64 32
```

Store it as `BALANCE_MONITOR_ENCRYPTION_KEY` in `apps/api/.env` for local development and in the
secret environment of both the API and worker in deployment. No default key is supplied. Monitor
writes require a valid key, and the worker validates its key at startup. Signing secrets are encrypted in
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

The monitor migration creates the final schema directly, without outbox or revision tables. It
refuses legacy rows that lack complete rule and webhook configuration; resolve those records
explicitly before applying it.

This feature is unreleased. Development and test databases that applied earlier branch migrations
must be recreated before replaying migration history. Old bearer-token jobs are incompatible with
signed delivery: use a fresh, dedicated development Valkey instance or clear only the obsolete
`exchequer-balance-monitors` job data while its API and worker are stopped. No automatic database or
queue reset, data conversion, or compatibility layer is provided.
