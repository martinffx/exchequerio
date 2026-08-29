import { Cause } from "effect";
import { describe, expect, it } from "vitest";

import { isPostgresUnavailable, postgresConstraint, postgresErrorCode } from "./errors";

describe("PostgreSQL error inspection", () => {
	it("reads errors wrapped in an Effect Cause", () => {
		const wrapped = {
			cause: Cause.fail({ code: "23505", constraint: "unique_account_name_per_ledger" }),
		};

		expect(postgresErrorCode(wrapped)).toBe("23505");
		expect(postgresConstraint(wrapped)).toBe("unique_account_name_per_ledger");
		expect(isPostgresUnavailable({ cause: Cause.fail({ code: "57P01" }) })).toBe(true);
	});
});
