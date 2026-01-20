import fastifyAuth from "@fastify/auth";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from "jose";

const { JOSEError, JWTClaimValidationFailed, JWTExpired } = errors;

import { TypeID } from "typeid-js";
import { ForbiddenError, UnauthorizedError } from "./errors";

// WorkOS JWT payload structure (from WorkOS)
type WorkOSAccessToken = {
	sub: string; // User ID (e.g., "user_01HXYZ...")
	sid: string; // Session ID (e.g., "session_01HXYZ...")
	org_id: string; // Organization ID (required)
	role?: string; // Role in organization (e.g., "admin", "member")
	permissions?: string[]; // Array of permission strings
	iat: number; // Issued at (Unix timestamp)
	exp: number; // Expiration (Unix timestamp)
};

// Authenticated user context (attached to request)
type AuthenticatedUser = {
	userId: string; // from JWT.sub
	sessionId: string; // from JWT.sid
	organizationId: string; // from JWT.org_id (required)
	role?: string; // from JWT.role
	permissions: string[]; // from JWT.permissions or mapped from role
};

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
type Permissions = (typeof Permissions)[number];
const OrgReadonlyPermissions = new Set<Permissions>([
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
const OrgUserPermissions = new Set<Permissions>([
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
	"ledger:account:balance_monitor:delete",
]);
const SuperAdminPermissions = new Set<Permissions>([
	...OrgAdminPermissions,
	"organization:read",
	"organization:write",
	"organization:delete",
]);

// WorkOS role to permission mapping
const WorkOSRolePermissions: Record<string, Set<Permissions>> = {
	admin: OrgAdminPermissions,
	member: OrgUserPermissions,
	viewer: OrgReadonlyPermissions,
	super_admin: SuperAdminPermissions,
};

// Helper function to resolve permissions from WorkOS JWT
function resolvePermissions(token: WorkOSAccessToken): string[] {
	// If JWT has explicit permissions, use them
	if (token.permissions && token.permissions.length > 0) {
		return token.permissions;
	}

	// Otherwise, map role to permissions
	if (token.role && WorkOSRolePermissions[token.role]) {
		return [...WorkOSRolePermissions[token.role]];
	}

	// No permissions available
	return [];
}

declare module "fastify" {
	interface FastifyInstance {
		verifyJWT: (request: FastifyRequest) => Promise<void>;
		hasPermissions: (
			permissions: Permissions[]
		) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
	}

	interface FastifyRequest {
		user: AuthenticatedUser;
	}
}

// Auth options for JWKS injection
export interface AuthOptions {
	jwks?: JWTVerifyGetKey; // If not provided, uses WorkOS remote JWKS
}

const registerAuth = async (server: FastifyInstance, options: AuthOptions = {}): Promise<void> => {
	// Use injected JWKS or default to WorkOS remote
	const JWKS =
		options.jwks ??
		createRemoteJWKSet(new URL(`https://api.workos.com/sso/jwks/${server.config.workosClientId}`));

	// WorkOS JWT verification
	server.decorate("verifyJWT", async (request: FastifyRequest) => {
		try {
			// Extract Bearer token from Authorization header
			const authHeader = request.headers.authorization;
			if (!authHeader || !authHeader.startsWith("Bearer ")) {
				throw new UnauthorizedError("Missing Authorization header");
			}

			const token = authHeader.substring(7); // Remove "Bearer " prefix

			// Verify JWT signature using JWKS
			const { payload } = await jwtVerify(token, JWKS, {
				issuer: "https://api.workos.com",
				audience: server.config.workosClientId,
			});

			// Extract and validate required claims
			const workosToken = payload as unknown as WorkOSAccessToken;
			if (!workosToken.sub || !workosToken.sid) {
				throw new UnauthorizedError("Invalid token claims");
			}

			// Validate org_id is present and valid TypeID
			if (!workosToken.org_id) {
				throw new UnauthorizedError("Missing organization ID in token");
			}

			let orgId: TypeID;
			try {
				orgId = TypeID.fromString(workosToken.org_id);
			} catch {
				throw new UnauthorizedError("Invalid organization ID format in token");
			}

			// Resolve permissions from role or explicit permissions
			const permissions = resolvePermissions(workosToken);

			// Attach authenticated user to request
			request.user = {
				userId: workosToken.sub,
				sessionId: workosToken.sid,
				organizationId: orgId.toString(),
				role: workosToken.role,
				permissions,
			};
		} catch (error: unknown) {
			request.log.error({ error }, "WorkOS JWT verification failed");

			// Handle specific error types
			if (error instanceof JWTExpired) {
				throw new UnauthorizedError("Token expired");
			}
			if (error instanceof JWTClaimValidationFailed) {
				throw new UnauthorizedError("Invalid token claims");
			}
			if (error instanceof JOSEError) {
				throw new UnauthorizedError("Invalid token signature");
			}

			// Re-throw domain errors
			if (error instanceof UnauthorizedError) {
				throw error;
			}

			// JWKS fetch failure or other system errors
			throw new Error("Authentication service unavailable");
		}
	});

	server.decorate("hasPermissions", (requiredPermissions: Permissions[]) => {
		return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
			if (!request.user) {
				throw new UnauthorizedError("Authentication required");
			}

			const userPermissions = new Set(request.user.permissions as Permissions[]);

			// Check required permissions
			for (const permission of requiredPermissions) {
				if (!userPermissions.has(permission)) {
					throw new ForbiddenError(`Missing required permission: ${permission}`);
				}
			}
		};
	});

	await server.register(fastifyAuth);
};

export { registerAuth };
