import { Effect, Option } from "effect";
import type { LedgerID, OrgID } from "@/repo/entities/types";
import type { LedgerCreateRow, LedgerRow, LedgerUpdateRow } from "@/repo/schema";
import { parseId } from "@/lib/utils";
import type { LedgerCreateRequest, LedgerUpdateRequest } from "../LedgerSchema";
import { LedgerPersistenceDecodingFailure } from "../LedgerErrors";

type LedgerMetadata = Readonly<Record<string, string>>;

type LedgerOptions = {
	readonly id: LedgerID;
	readonly organizationId: OrgID;
	readonly name: string;
	readonly description?: string;
	readonly metadata?: LedgerMetadata;
	readonly created: Date;
	readonly updated: Date;
};

const decodeDate = (value: Date): Date => {
	if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
		throw new Error("Invalid Ledger timestamp");
	}
	return value;
};

const decodeMetadata = (value: string | null): LedgerMetadata | undefined => {
	if (value === null) return undefined;
	const decoded: unknown = JSON.parse(value);
	if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
		throw new Error("Ledger metadata must be an object");
	}
	if (!Object.values(decoded).every(item => typeof item === "string")) {
		throw new Error("Ledger metadata values must be strings");
	}
	return decoded as Record<string, string>;
};

class Ledger {
	readonly id: LedgerID;
	readonly organizationId: OrgID;
	readonly name: string;
	readonly description?: string;
	readonly metadata?: LedgerMetadata;
	readonly created: Date;
	readonly updated: Date;

	constructor(options: LedgerOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.name = options.name;
		this.description = options.description;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	static fromRequest(
		id: LedgerID,
		organizationId: OrgID,
		request: LedgerCreateRequest | LedgerUpdateRequest
	): Ledger {
		const now = new Date();
		return new Ledger({ id, organizationId, ...request, created: now, updated: now });
	}

	static fromRow(
		row: LedgerRow | undefined
	): Effect.Effect<Option.Option<Ledger>, LedgerPersistenceDecodingFailure> {
		if (row === undefined) return Effect.succeed(Option.none());

		return Effect.gen(function* () {
			const id = yield* parseId<"lgr", LedgerID>("lgr", row.id);
			const organizationId = yield* parseId<"org", OrgID>("org", row.organizationId);
			const decoded = yield* Effect.try({
				try: () => ({
					created: decodeDate(row.created),
					updated: decodeDate(row.updated),
					metadata: decodeMetadata(row.metadata),
				}),
				catch: cause => cause,
			});
			const ledger = new Ledger({
				id,
				organizationId,
				name: row.name,
				description: row.description ?? undefined,
				metadata: decoded.metadata,
				created: decoded.created,
				updated: decoded.updated,
			});
			// eslint-disable-next-line unicorn/no-array-callback-reference -- Option.some receives a value.
			return Option.some(ledger);
		}).pipe(Effect.mapError(cause => new LedgerPersistenceDecodingFailure(cause)));
	}

	toCreateRow(): LedgerCreateRow {
		return {
			id: this.id.toString(),
			organizationId: this.organizationId.toString(),
			name: this.name,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			description: this.description ?? null,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			metadata: this.metadata === undefined ? null : JSON.stringify(this.metadata),
			created: this.created,
			updated: this.updated,
		};
	}

	toUpdateRow(): LedgerUpdateRow {
		return {
			name: this.name,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			description: this.description ?? null,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			metadata: this.metadata === undefined ? null : JSON.stringify(this.metadata),
			updated: this.updated,
		};
	}
}

export type { LedgerMetadata, LedgerOptions };
export { Ledger };
