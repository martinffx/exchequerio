import { describe, expect, it } from "vitest";
import { isPostgresUnavailable, postgresErrorCode } from "./PostgresErrors";

describe("PostgresErrors", () => {
	it.each([
		{ code: "08006" },
		{ code: "57P01" },
		{ code: "57P02" },
		{ code: "57P03" },
		{ code: "53300" },
		{ code: "ENOTFOUND" },
		{ code: "EAI_AGAIN" },
		{ code: "EPIPE" },
		{ message: "Connection terminated unexpectedly" },
		{ message: "Client has encountered a connection error and is not queryable" },
		{ message: "timeout exceeded when trying to connect" },
		{ cause: { code: "ECONNREFUSED" } },
		new AggregateError([{ code: "EHOSTUNREACH" }]),
	])("classifies an unavailable PostgreSQL error", error => {
		expect(isPostgresUnavailable(error)).toBe(true);
	});

	it("does not classify unrelated PostgreSQL errors as unavailable", () => {
		expect(isPostgresUnavailable({ code: "XX000" })).toBe(false);
	});

	it("finds a PostgreSQL code through nested causes", () => {
		expect(postgresErrorCode({ cause: { code: "23503" } })).toBe("23503");
	});

	it("finds a PostgreSQL code in aggregate errors", () => {
		expect(postgresErrorCode(new AggregateError([new Error("first"), { code: "23503" }]))).toBe(
			"23503"
		);
	});
});
