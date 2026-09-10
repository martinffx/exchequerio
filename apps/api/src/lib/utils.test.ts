import { Effect } from "effect";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import { describe, expect, it } from "vitest";
import { encodeUuid, parseUuid, parseDate } from "./utils";

describe("UUID persistence encoding", () => {
	it.each([
		"01890f00-0000-7000-8000-000000000001",
		"00000000-0000-0000-0000-000000000001",
		"00000000-0000-0000-0000-000000000000",
		"ffffffff-ffff-ffff-ffff-ffffffffffff",
	])("round trips all bits of %s without imposing a UUID version", uuid => {
		const id = TypeID.fromUUID("org", uuid);
		expect(encodeUuid(id)).toBe(uuid);
		const restored = Effect.runSync(parseUuid("org", uuid));
		expect(restored.toString()).toBe(id.toString());
	});
});

describe("Luxon date policy", () => {
	it("throws when constructing invalid dates", () => {
		expect(() => DateTime.fromISO("not-a-timestamp")).toThrow();
	});

	it("returns a typed failure when decoding an invalid persisted date", () => {
		const error = Effect.runSync(Effect.flip(parseDate(new Date(Number.NaN))));
		expect(error.message).toBe("Invalid persisted timestamp");
	});
});
