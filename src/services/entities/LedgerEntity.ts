import type { LedgerRequest, LedgerResponse } from "@/routes/ledgers/schema";
import { TypeID } from "typeid-js";

type LedgerID = TypeID<"lgr">;
type LedgerEntityOpts = {
	id?: LedgerID;
	name: string;
	description?: string;
};
class LedgerEntity {
	public readonly id: LedgerID;
	public readonly name: string;
	public readonly description?: string;

	constructor({ id, name, description }: LedgerEntityOpts) {
		this.id = id ?? new TypeID("lgr");
		this.name = name;
		this.description = description;
	}

	public static fromRequest(rq: LedgerRequest, id?: string): LedgerEntity {
		return new LedgerEntity({
			id: id ? TypeID.fromString(id) : undefined,
			name: rq.name,
			description: rq.description,
		});
	}

	public toResponse(): LedgerResponse {
		throw new Error("Not implemented");
	}
}

export type { LedgerID, LedgerEntityOpts };
export { LedgerEntity };
