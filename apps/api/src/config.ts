interface ConfigOptions {
	balanceMonitorEncryptionKey?: string;
	databaseUrl?: string;
	valkeyUrl?: string;
	jwtSecret?: string;
	environment?: string;
}

class Config {
	public readonly balanceMonitorEncryptionKey: string;
	public readonly databaseUrl: string;
	public readonly valkeyUrl: string;
	public readonly jwtSecret: string;
	public readonly environment: string;

	constructor({
		databaseUrl,
		valkeyUrl,
		jwtSecret,
		environment,
		balanceMonitorEncryptionKey,
	}: ConfigOptions = {}) {
		this.balanceMonitorEncryptionKey =
			balanceMonitorEncryptionKey ?? process.env.BALANCE_MONITOR_ENCRYPTION_KEY ?? "";
		this.databaseUrl = databaseUrl ?? process.env.DATABASE_URL ?? "";
		this.valkeyUrl = valkeyUrl ?? process.env.VALKEY_URL ?? "";
		this.jwtSecret = jwtSecret ?? process.env.JWT_SECRET ?? "";
		this.environment = environment ?? process.env.NODE_ENV ?? "development";
	}
}

export { Config };
