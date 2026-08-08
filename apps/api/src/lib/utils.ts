import { Effect } from "effect";
import { TypeID } from "typeid-js";
import { InvalidId } from "./errors";

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

export { parseId };
