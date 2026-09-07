import { type Static, Type } from "@sinclair/typebox";

const MetadataSchema = Type.Record(Type.String(), Type.String(), {
	description:
		"Additional data represented as key-value pairs. Both the key and value must be strings.",
});
type Metadata = Readonly<Static<typeof MetadataSchema>>;

export { MetadataSchema };
export type { Metadata };
