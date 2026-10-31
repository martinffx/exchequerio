import { inject } from "vitest";

// Point workers at the containers started in test.setup.ts. Undefined when globalSetup is skipped.
const databaseUrl = inject("databaseUrl");
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const valkeyUrl = inject("valkeyUrl");
if (valkeyUrl) process.env.VALKEY_URL = valkeyUrl;
