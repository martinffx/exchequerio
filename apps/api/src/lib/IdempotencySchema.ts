import { type Static, Type } from "@sinclair/typebox";

const IdempotencyHeaders = Type.Object({
	"idempotency-key": Type.String({ minLength: 1, maxLength: 255 }),
});

type IdempotencyHeaders = Static<typeof IdempotencyHeaders>;

export { IdempotencyHeaders };
