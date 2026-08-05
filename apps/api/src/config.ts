interface ConfigOptions {
	databaseUrl?: string;
	jwtSecret?: string;
	environment?: string;
	redisUrl?: string;
	organizationRateLimitMax?: number | string;
	organizationRateLimitWindowMs?: number | string;
}

const positiveInteger = (value: number | string, name: string): number => {
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
};

class Config {
	public readonly databaseUrl: string;
	public readonly jwtSecret: string;
	public readonly environment: string;
	public readonly redisUrl: string;
	public readonly organizationRateLimitMax: number;
	public readonly organizationRateLimitWindowMs: number;

	constructor({
		databaseUrl,
		jwtSecret,
		environment,
		redisUrl,
		organizationRateLimitMax,
		organizationRateLimitWindowMs,
	}: ConfigOptions = {}) {
		this.databaseUrl = databaseUrl ?? process.env.DATABASE_URL ?? "";
		this.jwtSecret = jwtSecret ?? process.env.JWT_SECRET ?? "";
		this.environment = environment ?? process.env.NODE_ENV ?? "development";
		this.redisUrl = redisUrl ?? process.env.REDIS_URL ?? "";
		if (this.redisUrl.length === 0) {
			throw new Error("REDIS_URL is required");
		}
		this.organizationRateLimitMax = positiveInteger(
			organizationRateLimitMax ?? process.env.ORGANIZATION_RATE_LIMIT_MAX ?? 1000,
			"ORGANIZATION_RATE_LIMIT_MAX"
		);
		this.organizationRateLimitWindowMs = positiveInteger(
			organizationRateLimitWindowMs ?? process.env.ORGANIZATION_RATE_LIMIT_WINDOW_MS ?? 60_000,
			"ORGANIZATION_RATE_LIMIT_WINDOW_MS"
		);
	}
}

export { Config };
