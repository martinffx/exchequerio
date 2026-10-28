import { Schema } from "effect";

/** Required client action key; clients generate a fresh UUID for each new action. */
const IdempotencyHeaders = Schema.Struct({
	"idempotency-key": Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)).annotate({
		description:
			"Generate a fresh UUID for every new client action, including actions on different endpoints. Reuse it only when retrying the same action. Internal calls belonging to that action carry its original key.",
	}),
});

/** Validated values derived from the IdempotencyHeaders transport schema. */
type IdempotencyHeaders = typeof IdempotencyHeaders.Type;

export { IdempotencyHeaders };
