import type {
	FastifyInstance,
	FastifyPluginAsync,
	FastifyReply,
	FastifyRequest,
} from "fastify";
import fastifyAuth from "@fastify/auth";
import fastifyJwt from "@fastify/jwt";
import { createSigner, type SignerSync } from "fast-jwt";
import { Config } from "./config";
import type { OrgID } from "./services";
import { TypeID } from "typeid-js";
import { ForbiddenError, UnauthorizedError } from "./errors";

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
	"ledger:account:balance_moniter:read",
	"ledger:account:balance_moniter:write",
	"ledger:account:balance_moniter:delete",
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
type Permissions = (typeof Permissions)[number];
const OrgReadonlyPermissions = new Set<Permissions>([
	"my:organization:read",
	"ledger:read",
	"ledger:account:read",
	"ledger:account:category:read",
	"ledger:account:settlement:read",
	"ledger:account:statement:read",
	"ledger:account:balance_moniter:read",
	"ledger:transaction:read",
	"ledger:transaction:entry:read",
]);
const OrgUserPermissions = new Set<Permissions>([
	...OrgReadonlyPermissions,
	"ledger:write",
	"ledger:transaction:write",
	"ledger:transaction:entry:write",
	"ledger:account:write",
	"ledger:account:category:write",
	"ledger:account:settlement:write",
	"ledger:account:statement:write",
	"ledger:account:balance_moniter:write",
]);

const OrgAdminPermissions = new Set<Permissions>([
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
	"ledger:account:balance_moniter:delete",
]);
const SuperAdminPermissions = new Set<Permissions>([
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
type Token = {
	sub: string;
	scope: Scope[];
};

class OrgToken {
	public readonly orgId: OrgID;
	public readonly scope: Scope[];
	constructor({ sub, scope }: Token) {
		this.orgId = TypeID.fromString(sub);
		this.scope = scope;
	}
}

declare module "fastify" {
	interface FastifyInstance {
		verifyJWT: (request: FastifyRequest) => Promise<void>;
		hasPermissions: (
			permissions: Permissions[],
		) => (request: FastifyRequest) => Promise<void>;
	}

	interface FastifyRequest {
		token: OrgToken;
	}
}

let jwtSigner: typeof SignerSync;
const sighJWT = (token: Token): string => {
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
		} catch (ex: unknown) {
			request.log.error(ex);
			throw new UnauthorizedError("Invalid token");
		}
	});
	server.decorate("hasPermissions", (requiredPermissions: Permissions[]) => {
		return async (request: FastifyRequest) => {
			const role = request.token.scope[0];
			const permissions = RolePermissions[role];
			if (!permissions) {
				throw new ForbiddenError(
					`One of: ${Object.keys(RolePermissions)}; permissions is required`,
				);
			}

			for (const permission of requiredPermissions) {
				if (!permissions.has(permission)) {
					throw new ForbiddenError(
						`One of: ${requiredPermissions}; permissions is required`,
					);
				}
			}
		};
	});
	await server.register(fastifyAuth);
};

export { registerAuth, sighJWT };
