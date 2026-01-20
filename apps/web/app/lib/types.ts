/**
 * User information stored in session.
 */
export interface User {
	/** WorkOS user ID */
	id: string;
	/** User's email address */
	email: string;
	/** Whether the user's email has been verified */
	emailVerified: boolean;
	/** User's first name (optional) */
	firstName?: string;
	/** User's last name (optional) */
	lastName?: string;
}

/**
 * Session data stored in encrypted cookie.
 * Contains authentication tokens and user information.
 */
export interface SessionData {
	/** JWT access token (expires in 5 minutes) */
	accessToken: string;
	/** Refresh token used to obtain new access tokens */
	refreshToken: string;
	/** Authenticated user information */
	user: User;
}
