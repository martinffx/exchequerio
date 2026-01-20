interface ConfigOptions {
	databaseUrl?: string;
	workosClientId?: string;
	environment?: string;
}
class Config {
	public readonly databaseUrl: string;
	public readonly workosClientId: string;
	public readonly environment: string;

	constructor({ databaseUrl, workosClientId, environment }: ConfigOptions = {}) {
		this.databaseUrl = databaseUrl ?? process.env.DATABASE_URL ?? "";
		this.workosClientId = workosClientId ?? process.env.WORKOS_CLIENT_ID ?? "";
		this.environment = environment ?? process.env.NODE_ENV ?? "development";
	}
}

export { Config };
