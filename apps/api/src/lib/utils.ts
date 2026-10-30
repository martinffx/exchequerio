import { Effect } from "effect";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import { InvalidId } from "./errors";
import type { LedgerID } from "./ids";
import type { Metadata } from "./schema";

const parseId = <Prefix extends string, Return extends TypeID<Prefix>>(
	prefix: Prefix,
	value: string
): Effect.Effect<Return, InvalidId> =>
	Effect.try({
		try: () => {
			const parsed = TypeID.fromString<Prefix>(value, prefix);
			if (parsed.toString() !== value) throw new Error("ID is not canonical");
			return parsed as Return;
		},
		catch: cause => new InvalidId(prefix, value, { cause }),
	});

const parseLedgerId = (ledgerId: string) => parseId<"lgr", LedgerID>("lgr", ledgerId);

// Canonical TypeIDs can contain any 128 bits; toUUID() additionally rejects non-RFC UUIDs.
const encodeUuid = (id: TypeID<string>): string =>
	Buffer.from(id.toUUIDBytes())
		.toString("hex")
		.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

const parseUuid = <Prefix extends string, Return extends TypeID<Prefix>>(
	prefix: Prefix,
	value: string
): Effect.Effect<Return, InvalidId> =>
	Effect.try({
		try: () => TypeID.fromUUID(prefix, value) as Return,
		catch: cause => new InvalidId(prefix, value, { cause }),
	});

const parseDate = (value: Date): Effect.Effect<DateTime, Error> =>
	Effect.try({
		try: () => DateTime.fromJSDate(value, { zone: "utc" }),
		catch: cause => new Error("Invalid persisted timestamp", { cause }),
	});

const parseMetadata = (value: string | null): Effect.Effect<Metadata | undefined, Error> =>
	value === null
		? Effect.succeed(undefined)
		: Effect.try({
				try: () => {
					const metadata: unknown = JSON.parse(value);
					if (
						typeof metadata !== "object" ||
						metadata === null ||
						Array.isArray(metadata) ||
						!Object.values(metadata).every(item => typeof item === "string")
					) {
						throw new Error("Invalid persisted metadata");
					}
					return metadata as Metadata;
				},
				catch: cause => new Error("Invalid persisted metadata", { cause }),
			});

const encodeMetadata = (metadata: Metadata | undefined): string | undefined =>
	metadata === undefined ? undefined : JSON.stringify(metadata);

/**
 * Route option for every state-changing endpoint: writes run to completion after a client
 * disconnect or drain cut, as under the pre-migration server, because services release or complete
 * idempotency claims and publish monitor jobs after commit. Reads stay interruptible.
 */
// review-decision: reads stay interruptible on client abort — @effect/sql-pg then cancels the in-flight query with pg_cancel_backend on a second pool connection; a stale-cancel race (the freed connection reused before the cancel lands, failing an unrelated statement with 57014) was found by code reading only and never reproduced. Reconsider if 57014 errors appear in logs, the pool saturates under load, or the race is reproduced.
const runToCompletion = { uninterruptible: true } as const;

export type { Metadata } from "./schema";
export {
	runToCompletion,
	encodeUuid,
	encodeMetadata,
	parseId,
	parseLedgerId,
	parseUuid,
	parseDate,
	parseMetadata,
};
