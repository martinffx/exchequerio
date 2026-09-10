import { Effect } from "effect";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import { InvalidId } from "./errors";
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

export type { Metadata } from "./schema";
export { encodeUuid, encodeMetadata, parseId, parseUuid, parseDate, parseMetadata };
