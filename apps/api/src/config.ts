interface ConfigOptions {
	balanceMonitorEncryptionKey?: string;
	databaseUrl?: string;
	valkeyUrl?: string;
	jwtSecret?: string;
	environment?: string;
}

/** Reads a positive integer variable; only an unset variable falls back to the default. */
const positiveIntegerFromEnv = (name: string, fallback: number): number => {
	const raw = process.env[name];
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (raw.trim() === "" || !Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive integer, received ${JSON.stringify(raw)}`);
	}
	return value;
};

class Config {
	public readonly balanceMonitorEncryptionKey: string;
	public readonly databaseUrl: string;
	public readonly valkeyUrl: string;
	public readonly jwtSecret: string;
	public readonly environment: string;
	public readonly rateLimitMax: number;
	public readonly rateLimitWindowSeconds: number;

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
		this.rateLimitMax = positiveIntegerFromEnv("RATE_LIMIT_MAX", 600);
		this.rateLimitWindowSeconds = positiveIntegerFromEnv("RATE_LIMIT_WINDOW_SECONDS", 60);
	}
}

export { Config };
