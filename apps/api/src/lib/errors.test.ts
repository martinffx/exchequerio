import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { OrganizationNotFound } from "@/domains/organizations/OrganizationErrors";
import { IdempotencyPending } from "@/lib/IdempotencyService";
import {
	BadRequestApiError,
	BadRequestError,
	ConflictApiError,
	ConflictError,
	ForbiddenApiError,
	ForbiddenError,
	HttpError,
	InternalServerApiError,
	InternalServerError,
	InvalidId,
	NotFoundApiError,
	NotFoundError,
	ServiceUnavailableApiError,
	ServiceUnavailableError,
	TooManyRequestsApiError,
	TooManyRequestsError,
	UnauthorizedApiError,
	UnauthorizedError,
} from "@/lib/errors";

const uuidv7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Encoded = {
	readonly body: Record<string, unknown>;
	readonly headers: Record<string, unknown>;
};
const encode = (schema: Schema.Top, error: unknown) =>
	Schema.encodeUnknownSync(schema as Schema.Codec<unknown, unknown>)(error) as Encoded;

describe("HttpError Schema encoding", () => {
	it.each([
		[BadRequestApiError, new BadRequestError("bad"), 400, "BAD_REQUEST", "Bad Request"],
		[UnauthorizedApiError, new UnauthorizedError("bad"), 401, "UNAUTHORIZED", "Unauthorized"],
		[ForbiddenApiError, new ForbiddenError("bad"), 403, "FORBIDDEN", "Forbidden"],
		[NotFoundApiError, new NotFoundError("bad"), 404, "NOT_FOUND", "Not Found"],
		[ConflictApiError, new ConflictError("bad"), 409, "CONFLICT", "Conflict"],
		[
			TooManyRequestsApiError,
			new TooManyRequestsError("bad"),
			429,
			"TOO_MANY_REQUESTS",
			"Too Many Requests",
		],
		[
			InternalServerApiError,
			new InternalServerError("bad"),
			500,
			"INTERNAL_SERVER_ERROR",
			"Internal Server Error",
		],
		[
			ServiceUnavailableApiError,
			new ServiceUnavailableError("bad"),
			503,
			"SERVICE_UNAVAILABLE",
			"Service Unavailable",
		],
	] as const)("encodes %# to the problem body", (schema, error, status, type, title) => {
		const { body } = encode(schema, error);

		expect(body).toMatchObject({ type, status, title, detail: "bad" });
		expect(body).not.toHaveProperty("_tag");
		expect(body).not.toHaveProperty("cause");
		expect(body.instance).toMatch(/^\/instance\//);
		expect((body.instance as string).slice("/instance/".length)).toMatch(uuidv7);
		expect(body.traceId).toMatch(uuidv7);
		expect(schema.ast.annotations?.httpApiStatus).toBe(status);
	});

	it("mints a fresh instance and traceId per encode", () => {
		const error = new NotFoundError("bad");
		const first = encode(NotFoundApiError, error).body;
		const second = encode(NotFoundApiError, error).body;

		expect(first.instance).not.toBe(second.instance);
		expect(first.traceId).not.toBe(second.traceId);
	});

	it("encodes retryable only when set", () => {
		expect(encode(ConflictApiError, new ConflictError("bad")).body).not.toHaveProperty("retryable");
		expect(
			encode(ConflictApiError, new ConflictError("bad", { retryable: true })).body
		).toMatchObject({ retryable: true });
	});

	it("makes ServiceUnavailable retryable by default", () => {
		expect(
			encode(ServiceUnavailableApiError, new ServiceUnavailableError("down")).body
		).toMatchObject({ retryable: true });
	});

	it("emits retry-after from retryAfterSeconds and keeps it out of the body", () => {
		const error = new ConflictError("bad", { retryAfterSeconds: 3 });
		const { body, headers } = encode(ConflictApiError, error);

		expect(headers["retry-after"]).toBe(3);
		expect(body).not.toHaveProperty("retryAfterSeconds");
		const plain = encode(ConflictApiError, new ConflictError("bad"));
		expect(plain.headers).not.toHaveProperty("retry-after");
		expect(plain.body).not.toHaveProperty("retryable");
	});

	it("keeps IdempotencyPending a 409 with Retry-After 1", () => {
		const { body, headers } = encode(ConflictApiError, new IdempotencyPending());

		expect(body).toMatchObject({ status: 409, retryable: true });
		expect(headers["retry-after"]).toBe(1);
	});

	it("never encodes the cause", () => {
		const cause = new Error("database credentials");
		const { body, headers } = encode(
			InternalServerApiError,
			new InternalServerError("boom", { cause })
		);

		expect(JSON.stringify({ body, headers })).not.toContain("database credentials");
		expect(new InternalServerError("boom", { cause }).cause).toBe(cause);
	});

	it("selects the 404 member of a union for a domain subclass", () => {
		const union = Schema.Union([BadRequestApiError, NotFoundApiError]);
		const { body } = encode(union, new OrganizationNotFound());

		expect(body).toMatchObject({ status: 404, type: "NOT_FOUND", detail: "Organization not found" });
	});

	it("selects the 400 member of a union for InvalidId", () => {
		const union = Schema.Union([BadRequestApiError, NotFoundApiError]);

		expect(encode(union, new InvalidId("org", "x")).body).toMatchObject({ status: 400 });
	});
});

describe("HttpError hierarchy", () => {
	it("keeps domain subclasses instances of HttpError with their status", () => {
		const notFound = new OrganizationNotFound();
		const invalid = new InvalidId("org", "x");

		expect(notFound).toBeInstanceOf(HttpError);
		expect(notFound).toBeInstanceOf(NotFoundError);
		expect(notFound.statusCode).toBe(404);
		expect(notFound.message).toBe("Organization not found");
		expect(notFound.name).toBe("OrganizationNotFound");
		expect(invalid).toBeInstanceOf(HttpError);
		expect(invalid).toBeInstanceOf(BadRequestError);
		expect(invalid.statusCode).toBe(400);
		expect(invalid.message).toBe("Invalid org id: x");
	});

	it("keeps cause and retryAfterSeconds on the instance", () => {
		const cause = new Error("root");
		const error = new ConflictError("bad", { cause, retryAfterSeconds: 2 });

		expect(error.cause).toBe(cause);
		expect(error.retryAfterSeconds).toBe(2);
	});
});
