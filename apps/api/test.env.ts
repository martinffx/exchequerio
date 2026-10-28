import { inject } from "vitest";

// Point workers at the container started in test.setup.ts. Undefined when globalSetup is skipped.
const databaseUrl = inject("databaseUrl");
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
