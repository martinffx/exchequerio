# Authentication & Authorization - Full Stack

## User Story

**As a** ledger API consumer (web app or external API client)
**I want to** authenticate securely using WorkOS and access organization-scoped resources
**So that** my financial data is protected with enterprise-grade authentication and proper permission controls

## Overview

Full-stack authentication system integrating WorkOS for user authentication and JWT-based API authorization. The web application provides custom-branded login/signup flows with passwordless and password-based authentication. The API verifies WorkOS JWTs using JWKS (public key cryptography) and enforces permission-based access control.

## Acceptance Criteria

### Web Application
1. ✅ User can sign up with email/password and receive email verification
2. ✅ User can log in with email/password and session is maintained via encrypted cookie
3. ✅ User can reset forgotten password via email link
4. ✅ User can authenticate using magic link (passwordless)
5. ✅ Web app transparently proxies `/api/*` requests to API with JWT from session
6. ✅ React Query works seamlessly for client-side data fetching through proxy
7. ✅ Session automatically refreshes when access token expires
8. ✅ JWT is never exposed to the browser (stays server-side)

### API
1. ✅ API validates WorkOS JWTs using JWKS endpoint before processing requests
2. ✅ Invalid or expired JWTs return 401 Unauthorized
3. ✅ Valid JWTs extract user ID, session ID, organization ID, and permissions
4. ✅ Permission system uses WorkOS roles/permissions from JWT
5. ✅ JWKS keys are cached with 5-minute cooldown to minimize API calls
6. ✅ Organization-scoped resources verify `org_id` matches requested resource

## Business Rules

### Authentication (Web)
- Email verification is required before users can access protected routes
- Password reset tokens expire after 24 hours
- Magic link codes expire after 10 minutes
- Maximum 3 password reset requests per email per hour (WorkOS rate limit)
- Users can choose between password or magic link authentication

### Session Management (Web)
- Access tokens expire after 5 minutes (WorkOS default)
- Session data stored in Cloudflare Workers KV with encrypted session ID in cookie
- Session cookies use `httpOnly`, `secure`, `sameSite=lax` flags
- Cookie secret must be 32+ characters for encryption
- Sessions automatically refresh on navigation if access token expired
- Logout deletes session from KV and clears session cookie
- Session revocation supported (can invalidate sessions immediately)

### JWT Validation (API)
- API rejects requests without valid WorkOS JWT (401)
- JWT signature must be verified against WorkOS JWKS endpoint
- JWT must not be expired (`exp` claim checked)
- JWT must contain required claims: `sub` (user ID), `sid` (session ID)
- Organization ID (`org_id`) is required for all organization-scoped routes

### Authorization (API)
- Permission system maps WorkOS roles to permission sets
- JWT `permissions` array overrides role-based permissions if present
- Routes requiring specific permissions check against JWT claims
- Organization-scoped routes verify `org_id` matches requested resource

### API Integration (Web)
- All `/api/*` routes are transparently proxied to backend API
- Proxy extracts JWT from session and adds `Authorization: Bearer` header
- Expired tokens are automatically refreshed before forwarding request
- Failed auth (401) redirects user to login page
- Proxy preserves HTTP method, headers, query params, and body

### Performance
- JWKS keys cached for 5 minutes (300 seconds)
- JWT verification adds < 5ms latency per request (cached JWKS)
- Session retrieval from KV adds < 10ms latency
- Failed JWT verification logged for debugging
- No database calls required for JWT validation (stateless)

## Scope

### Included
**Web Application:**
- Custom login/signup UI with shadcn/ui components (Button, Card, Input, Label, Form)
- Email + password authentication
- Email verification flow (code entry)
- Password reset flow (request → email → set new password)
- Magic link (passwordless) authentication (code entry)
- KV-based session management (Cloudflare Workers KV + encrypted cookie)
- Transparent `/api/*` proxy with JWT injection
- React Query integration for client-side data fetching
- Automatic token refresh on expiration
- Logout functionality with session revocation
- Protected route pattern (redirect to login if not authenticated)
- Cloudflare Workers deployment target

**API:**
- WorkOS JWT verification using JWKS
- JWKS caching with 5-minute cooldown
- JWT claim extraction (user ID, session ID, org ID, permissions)
- Integration with Fastify auth decorators (`verifyJWT`, `hasPermissions`)
- Map WorkOS roles to permission sets
- Error handling for invalid/expired tokens
- Logging for auth failures
- Organization-scoped resource access control

### Excluded (Future Phases)
- Hosted AuthKit UI (using custom forms instead)
- OAuth providers (Google, GitHub)
- Enterprise SSO/SAML
- Multi-factor authentication (MFA/2FA)
- Organization selection for multi-org users
- User profile management UI
- WorkOS webhook handling
- Admin user management via WorkOS API
- Directory sync integration
- Audit log integration
- Role-based access control UI

## Technical Design

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser Client                               │
│  (React Components, React Query, Forms)                              │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Cloudflare Workers (React Router SSR)                   │
│  ┌──────────────────────┐         ┌────────────────────────┐        │
│  │  Auth Routes         │         │  API Proxy Route       │        │
│  │  /login, /signup     │         │  /api/*                │        │
│  │  /verify-email       │◄────────┤  - Extract JWT from KV │        │
│  │  /reset-password     │         │  - Refresh if expired  │        │
│  │  /magic-link         │         │  - Add Auth header     │        │
│  │  /logout             │         │  - Forward to API      │        │
│  └──────────┬───────────┘         └────────────┬───────────┘        │
│             │                                   │                    │
│             │ Call WorkOS SDK                   │ Forward with JWT   │
│             ▼                                   ▼                    │
│  ┌──────────────────────┐         ┌────────────────────────┐        │
│  │ Session Management   │         │  Workers KV            │        │
│  │ (session.server.ts)  │◄────────┤  - accessToken (JWT)   │        │
│  │ - Create session     │         │  - refreshToken        │        │
│  │ - Get session        │         │  - user object         │        │
│  │ - Destroy session    │         │                        │        │
│  └──────────┬───────────┘         └────────────────────────┘        │
│             │                                                        │
│             │ Encrypted cookie: workos_session                       │
│             ▼                                                        │
└─────────────────────────────────────────────────────────────────────┘
             │                                   │
             │ WorkOS API Calls                  │ API Requests + JWT
             ▼                                   ▼
┌──────────────────────────┐       ┌────────────────────────────────┐
│     WorkOS API           │       │    Backend API (Fastify)        │
│  - authenticateWith...   │       │  ┌──────────────────────────┐  │
│  - createUser            │       │  │  Auth Middleware         │  │
│  - sendPasswordReset     │       │  │  (verifyJWT decorator)   │  │
│  - sendMagicAuthCode     │       │  │  1. Extract Bearer token │  │
│  - refreshAccessToken    │       │  │  2. Verify with JWKS     │  │
│  - revokeSession         │       │  │  3. Extract claims       │  │
│  └──────────────────────┘       │  │  4. Attach req.user      │  │
│                                  │  └──────────┬───────────────┘  │
│                                  │             │                  │
│                                  │             ▼                  │
│                                  │  ┌──────────────────────────┐  │
│                                  │  │  Permission Middleware   │  │
│                                  │  │  (hasPermissions)        │  │
│                                  │  │  - Check JWT permissions │  │
│                                  │  │  - Validate org_id       │  │
│                                  │  └──────────┬───────────────┘  │
│                                  │             │                  │
│                                  │             ▼                  │
│                                  │  ┌──────────────────────────┐  │
│                                  │  │  Route Handlers          │  │
│                                  │  │  (req.user available)    │  │
│                                  │  └──────────────────────────┘  │
│                                  └────────────────────────────────┘
└──────────────────────────┘
                                         JWKS Endpoint
                                         https://api.workos.com/sso/jwks/{client_id}
```

### Data Flow

**Authentication Flow (Login):**
1. User submits email/password on `/login` route
2. Web app calls `authenticateWithPassword()` via WorkOS SDK
3. WorkOS returns `{ accessToken, refreshToken, user }`
4. Web app stores tokens + user in Workers KV session
5. Web app sets encrypted `workos_session` cookie
6. User redirected to `/dashboard`

**API Request Flow:**
1. Browser makes request to `/api/ledgers` (proxied)
2. Web app proxy extracts session from KV using cookie
3. Proxy checks if `accessToken` is expired
4. If expired: refresh token → update KV session
5. Proxy forwards request with `Authorization: Bearer ${accessToken}`
6. API verifies JWT signature using JWKS
7. API extracts `user`, `org_id`, `permissions` from JWT
8. API checks permissions for route
9. API processes request and returns response
10. Proxy forwards response to browser

### Components

#### Web Application (`apps/web`)

**1. Session Management (`app/lib/session.server.ts`)**
```typescript
// Creates session storage backed by Cloudflare Workers KV
export function createSessionStorage(kv: KVNamespace)

// Retrieves session data from KV using cookie
export async function getUserSession(request: Request, kv: KVNamespace): Promise<SessionData | null>

// Session data structure
type SessionData = {
  accessToken: string    // WorkOS JWT
  refreshToken: string   // WorkOS refresh token
  user: User            // User object from WorkOS
}
```

**2. Authentication Service (`app/lib/auth.server.ts`)**
```typescript
// WorkOS SDK integration functions
export async function authenticateWithPassword(email: string, password: string): Promise<AuthResponse>
export async function createUser(email: string, password: string): Promise<CreateUserResponse>
export async function verifyEmailCode(email: string, code: string): Promise<AuthResponse>
export async function createPasswordReset(email: string): Promise<void>
export async function resetPassword(token: string, newPassword: string): Promise<void>
export async function sendMagicAuthCode(email: string): Promise<void>
export async function authenticateWithMagicAuth(code: string, email: string): Promise<AuthResponse>
export async function refreshAccessToken(refreshToken: string): Promise<AuthResponse>
export async function logoutUser(userId: string): Promise<void>

// Error transformation
function transformWorkOSError(error: any): Error
```

**3. API Proxy (`app/routes/api.$.tsx`)**
```typescript
// Catch-all route for /api/*
export async function loader({ request, params, context }: Route.LoaderArgs)
export async function action({ request, params, context }: Route.ActionArgs)

// Flow:
// 1. Get session from KV
// 2. Refresh token if expired
// 3. Forward request with Authorization header
// 4. Return API response
```

**4. Auth Routes**
- `/login` - Login form + action
- `/signup` - Signup form + action
- `/logout` - Logout action (clears session)
- `/forgot-password` - Request password reset
- `/reset-password` - Set new password (with token)
- `/verify-email` - Email verification code entry
- `/magic-link` - Magic link code entry

**5. Auth Components (`app/components/auth/`)**
- `LoginForm.tsx` - Email/password form
- `SignupForm.tsx` - Registration form
- `VerifyEmailForm.tsx` - 6-digit code entry
- `ForgotPasswordForm.tsx` - Email input for reset
- `ResetPasswordForm.tsx` - New password form
- `MagicLinkForm.tsx` - Email input + code entry
- `PasswordInput.tsx` - Password with show/hide toggle
- `CodeInput.tsx` - 6-digit code with auto-advance

#### API (`apps/api`)

**1. Configuration (`src/config.ts`)**
```typescript
// WorkOS configuration
workosClientId: string  // From WORKOS_CLIENT_ID env var
```

**2. Auth Module (`src/auth.ts`)**
```typescript
// WorkOS JWT payload structure
type WorkOSAccessToken = {
  sub: string           // User ID
  sid: string           // Session ID
  org_id: string        // Organization ID (required)
  role?: string         // Role in organization
  permissions?: string[] // Explicit permissions
  iat: number           // Issued at
  exp: number           // Expiration
}

// Authenticated user context
type AuthenticatedUser = {
  userId: string
  sessionId: string
  organizationId: string
  role?: string
  permissions: string[]
}

// Fastify decorators
server.verifyJWT(request: FastifyRequest): Promise<void>
server.hasPermissions(requiredPermissions: Permissions[]): Promise<void>

// Fastify request augmentation
declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser
  }
}

// Initialize JWKS and register auth decorators
export async function registerAuth(server: FastifyInstance, options?: AuthOptions): Promise<void>
```

**3. Permission System**
```typescript
// Permission definitions
const Permissions = [
  "ledger:read",
  "ledger:write",
  "ledger:delete",
  "ledger:account:read",
  "ledger:account:write",
  // ... all permissions
] as const

type Permissions = typeof Permissions[number]

// Role to permission mapping
const WorkOSRolePermissions = {
  admin: OrgAdminPermissions,
  member: OrgUserPermissions,
  viewer: OrgReadonlyPermissions,
  super_admin: SuperAdminPermissions,
}

// Permission resolution from JWT
function resolvePermissions(token: WorkOSAccessToken): string[]
```

**4. Route Protection**
```typescript
// Example protected route
server.get(
  "/ledgers/:id",
  {
    onRequest: [
      server.verifyJWT,
      server.hasPermissions(["ledger:read"])
    ]
  },
  async (request, reply) => {
    // request.user is available here
    const { userId, organizationId, permissions } = request.user
    // ... route logic
  }
)
```

### WorkOS Integration

**JWKS URL:**
```
https://api.workos.com/sso/jwks/{WORKOS_CLIENT_ID}
```

**JWT Claims:**
```json
{
  "sub": "user_01HXYZ...",
  "sid": "session_01HXYZ...",
  "org_id": "org_01HXYZ...",
  "role": "admin",
  "permissions": ["ledger:read", "ledger:write"],
  "iat": 1234567890,
  "exp": 1234567890
}
```

### Error Handling

#### Web Application

| Error Code | Description | Handling |
|------------|-------------|----------|
| `email_verification_required` | Email not verified | Redirect to `/verify-email?email=${email}` |
| `invalid_credentials` | Wrong email/password | Show error on form |
| `user_not_found` | Email doesn't exist | Show error on form |
| `invalid_grant` | Invalid/expired token | Redirect to `/login` |
| `rate_limit_exceeded` | Too many requests | Show "try again later" message |

#### API

| Error | HTTP Status | Response |
|-------|-------------|----------|
| Missing `Authorization` header | 401 | `{ error: "Missing Authorization header" }` |
| Invalid JWT format | 401 | `{ error: "Invalid token format" }` |
| Expired JWT | 401 | `{ error: "Token expired" }` |
| Invalid signature | 401 | `{ error: "Invalid token signature" }` |
| Missing required claims | 401 | `{ error: "Invalid token claims" }` |
| Invalid organization ID | 401 | `{ error: "Invalid organization ID format in token" }` |
| Insufficient permissions | 403 | `{ error: "Missing required permission: <permission>" }` |
| JWKS fetch failure | 500 | `{ error: "Authentication service unavailable" }` |

### Environment Variables

**Web Application (`apps/web/.env`):**
```bash
# WorkOS Configuration
WORKOS_CLIENT_ID=client_...
WORKOS_API_KEY=sk_test_...
WORKOS_COOKIE_PASSWORD=<32+ character secure password>

# Backend API (server-side only, for proxy)
API_URL=http://localhost:3000
```

**API (`apps/api/.env`):**
```bash
# WorkOS Configuration (for JWT verification)
WORKOS_CLIENT_ID=client_...
```

**Cloudflare Workers KV (`wrangler.toml`):**
```toml
[[kv_namespaces]]
binding = "SESSION_KV"
id = "<production-kv-id>"
preview_id = "<preview-kv-id>"
```

### Dependencies

**Web Application:**
```json
{
  "dependencies": {
    "@workos-inc/node": "^7.x",
    "@react-router/cloudflare": "^7.x",
    "@tanstack/react-query": "^5.x"
  }
}
```

**API:**
```json
{
  "dependencies": {
    "jose": "^5.x",
    "@fastify/auth": "^5.x",
    "typeid-js": "^1.x"
  }
}
```

## UI/UX Considerations

### Login Page
- Email input with validation
- Password input with show/hide toggle
- "Forgot password?" link
- "Sign up" link
- Optional: "Use magic link instead" toggle
- Error messages displayed inline

### Signup Page
- Email input with validation
- Password input with strength indicator
- Password confirmation input
- Terms of service checkbox
- Submit → sends verification email
- Redirect to verification page

### Email Verification
- 6-digit code entry (auto-advance on paste)
- "Resend code" button (disabled for 60s)
- Auto-submit when 6 digits entered
- Success → redirect to dashboard/home

### Password Reset
- Step 1: Enter email → send reset link
- Step 2: Click link in email → redirect to reset page with token
- Step 3: Enter new password + confirm → submit
- Success → redirect to login

### Magic Link
- Enter email → send code
- Enter 6-digit code
- Success → authenticated

### Protected Routes
- Unauthenticated users redirected to `/login`
- Return URL preserved in query param: `/login?returnTo=/dashboard`
- After login, redirect to original destination

## Success Metrics

### Functional
- ✅ Users can authenticate without seeing WorkOS branding
- ✅ Session persists across browser refreshes
- ✅ API calls work transparently through proxy
- ✅ React Query caching works as expected
- ✅ No 401 errors from expired tokens (auto-refresh works)
- ✅ JWT never visible in browser DevTools
- ✅ All routes protected with WorkOS JWT verification
- ✅ Clear 401/403 error messages for debugging

### Performance
- JWT verification adds < 5ms latency per request (cached JWKS)
- Session retrieval from KV adds < 10ms latency
- First request with new JWKS key < 100ms (JWKS fetch)
- JWKS caching works (no repeated fetches within 5 min)

### Security
- JWKS endpoint uses HTTPS (verified certificates)
- JWKS keys cached securely in memory
- JWT signature verified before trusting claims
- Expired tokens rejected immediately
- No sensitive data logged (token values redacted)
- Organization ID validated against requested resources
- Session cookies use `httpOnly`, `secure`, `sameSite=lax` flags

## Testing Strategy

### Unit Tests

**Web Application:**
- Session seal/unseal functions
- WorkOS API call wrappers
- Token expiration detection
- Error handling for auth failures
- Error transformation (WorkOS → custom errors)

**API:**
- JWKS verification with valid JWT
- JWKS verification with expired JWT
- JWKS verification with invalid signature
- Permission mapping from WorkOS roles
- Error handling for missing claims
- Organization ID validation

### Integration Tests

**Web Application:**
- Full login flow (signup → verify → login)
- Password reset flow
- Magic link flow
- Session refresh on expired token
- Proxy forwards requests correctly
- Auto-redirect to login on 401

**API:**
- Protected route with valid WorkOS JWT (200)
- Protected route with expired JWT (401)
- Protected route without JWT (401)
- Protected route with insufficient permissions (403)
- Organization-scoped route with wrong org_id (403)

### E2E Tests

**Full Stack:**
- User signs up and verifies email
- User logs in and accesses protected page
- User makes API request through proxy (JWT injected)
- User resets forgotten password
- User logs out and cannot access protected page
- Session persists across page reloads
- Expired token auto-refreshes before API call

## Implementation Notes

### Current Status
This specification documents the **existing implementation** of authentication and authorization across the full stack. Both the web application and API are fully implemented and tested.

### Key Files

**Web Application:**
- `apps/web/app/lib/auth.server.ts` - WorkOS SDK integration
- `apps/web/app/lib/session.server.ts` - Session management
- `apps/web/app/routes/api.$.tsx` - API proxy with JWT injection
- `apps/web/app/routes/login.tsx` - Login route
- `apps/web/app/routes/signup.tsx` - Signup route
- `apps/web/app/routes/logout.tsx` - Logout route
- `apps/web/app/routes/verify-email.tsx` - Email verification
- `apps/web/app/routes/forgot-password.tsx` - Password reset request
- `apps/web/app/routes/reset-password.tsx` - Password reset
- `apps/web/app/routes/magic-link.tsx` - Magic link auth
- `apps/web/app/components/auth/*` - Auth UI components

**API:**
- `apps/api/src/auth.ts` - JWT verification and permission system
- `apps/api/src/config.ts` - WorkOS configuration
- `apps/api/src/errors.ts` - Auth error definitions
- `apps/api/src/server.ts` - Auth registration

### Security Considerations

**Web Application:**
- Cookie encryption using 32+ character secret
- `httpOnly` cookies prevent XSS attacks
- `secure` flag enforces HTTPS
- `sameSite=lax` provides CSRF protection
- JWT never sent to browser (stays in KV)
- Session revocation supported via WorkOS

**API:**
- Stateless JWT verification (no DB lookups)
- Public key cryptography (JWKS) prevents token forgery
- JWT signature verified on every request
- Expired tokens rejected immediately
- Organization ID validated as TypeID format
- All auth failures logged for security monitoring

### Migration from Separate Specs

This unified specification consolidates previously separate specs for:
- Web authentication (formerly in `apps/web/docs/spec/workos-auth/`)
- API JWT verification (formerly in `apps/api/docs/spec/workos-jwt/`)

The separate specs have been removed in favor of this unified specification. Historical versions are preserved in git history.
