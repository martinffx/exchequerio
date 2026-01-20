/**
 * Base authentication error class.
 * All authentication-related errors extend this class.
 */
export class AuthError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly statusCode: number = 401
	) {
		super(message);
		this.name = "AuthError";
	}
}

/**
 * Error thrown when email verification is required before proceeding.
 * User should be redirected to email verification page.
 */
export class EmailVerificationRequiredError extends AuthError {
	constructor() {
		super("email_verification_required", "Email verification required", 403);
	}
}

/**
 * Error thrown when user provides invalid credentials (email/password).
 * Generic message to avoid leaking information about which field is invalid.
 */
export class InvalidCredentialsError extends AuthError {
	constructor() {
		super("invalid_credentials", "Invalid email or password", 401);
	}
}

/**
 * Error thrown when rate limit is exceeded.
 * User should wait before retrying the operation.
 */
export class RateLimitError extends AuthError {
	constructor() {
		super("rate_limit_exceeded", "Too many requests. Please try again later.", 429);
	}
}
