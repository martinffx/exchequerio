interface ConfigOptions {
	databaseUrl?: string;
	jwtSecret?: string;
	environment?: string;
}
class Config {
	public readonly databaseUrl: string;
	public readonly jwtSecret: string;
	public readonly environment: string;

	constructor({ databaseUrl, jwtSecret, environment }: ConfigOptions = {}) {
		this.databaseUrl = databaseUrl ?? process.env.DATABASE_URL ?? "";
		this.jwtSecret = jwtSecret ?? process.env.JWT_SECRET ?? "";
		this.environment = environment ?? process.env.NODE_ENV ?? "development";
	}
}

export { Config };
