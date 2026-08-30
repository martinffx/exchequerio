import { afterEach, describe, expect, it } from "vitest";

import { Config } from "@/config";
import { LedgerAccountSettlementServiceTag } from "@/domains/ledgers/settlements";

import { makeServerRuntimeLayer, ServerRuntime } from "./runtime";

describe("server runtime", () => {
	const runtime = new ServerRuntime(makeServerRuntimeLayer(new Config()));

	afterEach(() => runtime.dispose());

	it("resolves the Settlement service", async () => {
		const service = await runtime.runPromise(LedgerAccountSettlementServiceTag);

		expect(service).toBeDefined();
	});
});
