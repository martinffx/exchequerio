interface ConfigOpts {
	databaseUrl?: string
	jwtSecret?: string
}
class Config {
	public readonly databaseUrl: string
	public readonly jwtSecret: string

	constructor({ databaseUrl, jwtSecret }: ConfigOpts = {}) {
		this.databaseUrl = databaseUrl ?? process.env.DATABASE_URL ?? ""
		this.jwtSecret = jwtSecret ?? process.env.JWT_SECRET ?? ""
	}
}

export { Config }
