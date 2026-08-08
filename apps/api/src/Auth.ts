import fastifyAuth from "@fastify/auth";
import fastifyJwt from "@fastify/jwt";
import { Effect, Result } from "effect";
import { createSigner, type SignerSync } from "fast-jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Config } from "./Config";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { parseId } from "@/lib/utils";
import type { OrgID } from "./services";

const Permissions = [
	"ledger:read",
	"ledger:write",
	"ledger:delete",
	"ledger:account:read",
	"ledger:account:write",
	"ledger:account:delete",
	"ledger:account:category:read",
	"ledger:account:category:write",
	"ledger:account:category:delete",
	"ledger:account:settlement:read",
	"ledger:account:settlement:write",
	"ledger:account:settlement:delete",
	"ledger:account:statement:read",
	"ledger:account:statement:write",
	"ledger:account:statement:delete",
	"ledger:account:balance_monitor:read",
	"ledger:account:balance_monitor:write",
	"ledger:account:balance_monitor:delete",
	"ledger:transaction:read",
	"ledger:transaction:write",
	"ledger:transaction:delete",
	"ledger:transaction:entry:read",
	"ledger:transaction:entry:write",
	"ledger:transaction:entry:delete",
	"my:organization:read",
	"my:organization:write",
	"my:organization:delete",
	"organization:read",
	"organization:write",
	"organization:delete",
] as const;
type Permission = (typeof Permissions)[number];
const OrgReadonlyPermissions = new Set<Permission>([
	"my:organization:read",
	"ledger:read",
	"ledger:account:read",
	"ledger:account:category:read",
	"ledger:account:settlement:read",
	"ledger:account:statement:read",
	"ledger:account:balance_monitor:read",
	"ledger:transaction:read",
	"ledger:transaction:entry:read",
]);
const OrgUserPermissions = new Set<Permission>([
	...OrgReadonlyPermissions,
	"ledger:write",
	"ledger:transaction:write",
	"ledger:transaction:entry:write",
	"ledger:account:write",
	"ledger:account:category:write",
	"ledger:account:settlement:write",
	"ledger:account:statement:write",
	"ledger:account:balance_monitor:write",
]);
const OrgAdminPermissions = new Set<Permission>([
	...OrgUserPermissions,
	"my:organization:read",
	"my:organization:write",
	"my:organization:delete",
	"ledger:delete",
	"ledger:transaction:delete",
	"ledger:transaction:entry:delete",
	"ledger:account:delete",
	"ledger:account:category:delete",
	"ledger:account:settlement:delete",
	"ledger:account:statement:delete",
	"ledger:account:balance_monitor:delete",
]);
const SuperAdminPermissions = new Set<Permission>([
	...OrgAdminPermissions,
	"organization:read",
	"organization:write",
	"organization:delete",
]);
const RolePermissions = {
	super_admin: SuperAdminPermissions,
	org_admin: OrgAdminPermissions,
	org_user: OrgUserPermissions,
	org_readonly: OrgReadonlyPermissions,
} as const;
const Scope = {
	SuperAdmin: "super_admin",
	OrgAdmin: "org_admin",
	OrgUser: "org_user",
	OrgReadonly: "org_readonly",
} as const;
type Scope = (typeof Scope)[keyof typeof Scope];
interface Token {
	sub: string;
	scope: Scope[];
}

class OrgToken {
	public readonly orgId: OrgID;
	public readonly organizationId: OrgID;
	public readonly scope: Scope[];
	public readonly permissions: ReadonlySet<Permission>;
	constructor({ sub, scope }: Token) {
		const organizationId = Effect.runSync(Effect.result(parseId<"org", OrgID>("org", sub)));
		if (Result.isFailure(organizationId))
			throw new Error("JWT subject is not a canonical Organization ID");
		this.orgId = organizationId.success;
		this.organizationId = organizationId.success;
		this.scope = scope;
		this.permissions = RolePermissions[scope[0]] ?? new Set<Permission>();
	}
}

declare module "fastify" {
	interface FastifyInstance {
		verifyJWT: (request: FastifyRequest) => Promise<void>;
		hasPermissions: (
			permissions: Permission[]
		) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
	}
	interface FastifyRequest {
		token: OrgToken;
	}
}

let jwtSigner: typeof SignerSync;
const signJWT = (token: Token): string => {
	if (jwtSigner === undefined) {
		const config = new Config();
		jwtSigner = createSigner({ key: config.jwtSecret });
	}
	return jwtSigner(token);
};

const registerAuth = async (server: FastifyInstance): Promise<void> => {
	await server.register(fastifyJwt, { secret: server.config.jwtSecret });
	server.decorate("verifyJWT", async (request: FastifyRequest) => {
		try {
			const token = await request.jwtVerify<Token>();
			request.token = new OrgToken(token);
		} catch (error: unknown) {
			request.log.error(error);
			throw new UnauthorizedError("Invalid token");
		}
	});
	server.decorate("hasPermissions", (requiredPermissions: Permission[]) => {
		return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
			for (const permission of requiredPermissions) {
				if (!request.token.permissions.has(permission)) {
					throw new ForbiddenError(`One of: ${requiredPermissions.join(", ")}; permissions is required`);
				}
			}
		};
	});
	await server.register(fastifyAuth);
};

export type { Permission };
export { registerAuth, signJWT };
