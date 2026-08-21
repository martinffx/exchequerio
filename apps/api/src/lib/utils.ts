import { Effect } from "effect";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import { InvalidId } from "./errors";

type Metadata = Readonly<Record<string, string>>;

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

const parseDate = (value: Date): Effect.Effect<DateTime, Error> =>
	Effect.try({
		try: () => {
			const date = DateTime.fromJSDate(value, { zone: "utc" });
			if (!date.isValid) throw new Error("Invalid persisted timestamp");
			return date;
		},
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

export type { Metadata };
export { parseId, parseDate, parseMetadata };
