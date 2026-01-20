import { WorkOS } from "@workos-inc/node";
import {
	AuthError,
	EmailVerificationRequiredError,
	InvalidCredentialsError,
	RateLimitError,
} from "./errors";
import type { User } from "./types";

// Lazy-initialize WorkOS client to avoid errors during test imports
let workos: WorkOS | null = null;
let clientId: string | null = null;

function getWorkOSClient() {
	if (!workos) {
		workos = new WorkOS(process.env.WORKOS_API_KEY);
		clientId = process.env.WORKOS_CLIENT_ID || "";
	}
	return { workos, clientId: clientId! };
}

/**
 * Authentication response from WorkOS.
 */
export interface AuthResponse {
	accessToken: string;
	refreshToken: string;
	user: User;
}

/**
 * User creation response from WorkOS.
 */
export interface CreateUserResponse {
	id: string;
	email: string;
	emailVerified: boolean;
	firstName?: string;
	lastName?: string;
}

/**
 * Authenticates a user with email and password.
 *
 * @param email - User's email address
 * @param password - User's password
 * @returns Authentication response with tokens and user data
 * @throws EmailVerificationRequiredError when email verification is required
 * @throws InvalidCredentialsError when credentials are invalid
 * @throws RateLimitError when rate limit is exceeded
 * @throws AuthError for other authentication errors
 */
export async function authenticateWithPassword(
	email: string,
	password: string
): Promise<AuthResponse> {
	try {
		const { workos, clientId } = getWorkOSClient();
		const response = await workos.userManagement.authenticateWithPassword({
			clientId,
			email,
			password,
		});

		return response as AuthResponse;
	} catch (error: any) {
		throw transformWorkOSError(error);
	}
}

/**
 * Creates a new user account.
 *
 * @param email - User's email address
 * @param password - User's password
 * @returns Created user information
 * @throws AuthError when user creation fails
 */
export async function createUser(email: string, password: string): Promise<CreateUserResponse> {
	try {
		const { workos } = getWorkOSClient();
		const response = await workos.userManagement.createUser({
			email,
			password,
		});

		return response as CreateUserResponse;
	} catch (error: any) {
		throw transformWorkOSError(error);
	}
}

/**
 * Verifies email with a verification code.
 *
 * @param email - User's email address
 * @param code - Verification code sent to email
 * @returns Authentication response with tokens and user data
 * @throws AuthError when verification fails
 */
export async function verifyEmailCode(email: string, code: string): Promise<AuthResponse> {
	try {
		const { workos, clientId } = getWorkOSClient();
		const response = await workos.userManagement.authenticateWithCode({
			clientId,
			code,
			email,
		});

		return response as AuthResponse;
	} catch (error: any) {
		throw transformWorkOSError(error);
	}
}

/**
 * Initiates password reset flow by sending reset email.
 *
 * @param email - User's email address
 * @throws RateLimitError when rate limit is exceeded
 * @throws AuthError for other errors
 */
export async function createPasswordReset(email: string): Promise<void> {
	try {
		const { workos } = getWorkOSClient();
		await workos.userManagement.sendPasswordResetEmail({
			email,
		});
	} catch (error: any) {
		throw transformWorkOSError(error);
	}
}

/**
 * Resets user password with reset token.
 *
 * @param token - Password reset token from email
 * @param newPassword - New password to set
 * @throws AuthError when reset fails
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
	try {
		const { workos } = getWorkOSClient();
		await workos.userManagement.resetPassword({
			token,
			newPassword,
		});
	} catch (error: any) {
		throw transformWorkOSError(error);
	}
}

/**
 * Sends magic authentication code to user's email.
 *
 * @param email - User's email address
 * @throws RateLimitError when rate limit is exceeded
 * @throws AuthError for other errors
 */
export async function sendMagicAuthCode(email: string): Promise<void> {
	try {
		const { workos } = getWorkOSClient();
		await workos.userManagement.sendMagicAuthCode({
			email,
		});
	} catch (error: any) {
		throw transformWorkOSError(error);
	}
}

/**
 * Authenticates user with magic authentication code.
 *
 * @param code - Magic auth code from email
 * @param email - User's email address
 * @returns Authentication response with tokens and user data
 * @throws AuthError when authentication fails
 */
export async function authenticateWithMagicAuth(
	code: string,
	email: string
): Promise<AuthResponse> {
	try {
		const { workos, clientId } = getWorkOSClient();
		const response = await workos.userManagement.authenticateWithMagicAuth({
			clientId,
			code,
			email,
		});

		return response as AuthResponse;
	} catch (error: any) {
		throw transformWorkOSError(error);
	}
}

/**
 * Refreshes access token using refresh token.
 *
 * @param refreshToken - Valid refresh token
 * @returns New authentication response with refreshed tokens
 * @throws AuthError when refresh fails
 */
export async function refreshAccessToken(refreshToken: string): Promise<AuthResponse> {
	try {
		const { workos, clientId } = getWorkOSClient();
		const response = await workos.userManagement.authenticateWithRefreshToken({
			clientId,
			refreshToken,
		});

		return response as AuthResponse;
	} catch (error: any) {
		throw transformWorkOSError(error);
	}
}

/**
 * Logs out user by revoking their session.
 *
 * @param userId - User ID to logout
 */
export async function logoutUser(userId: string): Promise<void> {
	try {
		const { workos } = getWorkOSClient();
		await workos.userManagement.revokeSession({
			userId,
		});
	} catch (error: any) {
		// Ignore logout errors - logout should be silent
		console.error("Logout error:", error);
	}
}

/**
 * Transforms WorkOS SDK errors into custom error types.
 *
 * @param error - Error from WorkOS SDK
 * @returns Transformed custom error
 */
function transformWorkOSError(error: any): Error {
	const code = error.code || error.error;

	switch (code) {
		case "email_verification_required":
			return new EmailVerificationRequiredError();
		case "invalid_credentials":
		case "user_not_found":
			return new InvalidCredentialsError();
		case "rate_limit_exceeded":
			return new RateLimitError();
		case "invalid_grant":
			return new AuthError("invalid_grant", "Invalid or expired token", 401);
		default:
			return new AuthError(
				code || "unknown_error",
				error.message || "An error occurred",
				error.statusCode || 500
			);
	}
}
