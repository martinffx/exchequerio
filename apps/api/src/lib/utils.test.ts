import { Effect } from "effect";
import { TypeID } from "typeid-js";
import { describe, expect, it } from "vitest";
import { encodeUuid, parseUuid } from "./utils";

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
