import { type Static, Type } from "@sinclair/typebox";

const IdempotencyHeaders = Type.Object({
	"idempotency-key": Type.String({
		minLength: 1,
		maxLength: 255,
		description:
			"Generate a fresh UUID for every new client action, including actions on different endpoints. Reuse it only when retrying the same action. Internal calls belonging to that action carry its original key.",
	}),
});

type IdempotencyHeaders = Static<typeof IdempotencyHeaders>;

export { IdempotencyHeaders };
