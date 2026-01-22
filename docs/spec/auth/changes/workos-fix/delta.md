# Technical Delta: Fix WorkOS Authentication Implementation

## MODIFIED: Web Application Session Management

### File: `apps/web/app/lib/session.server.ts`

#### Before (Broken):
```typescript
/**
 * Creates session storage backed by Cloudflare Workers KV
 */
export function createSessionStorage(kv: KVNamespace) {
  const COOKIE_SECRET = process.env.WORKOS_COOKIE_PASSWORD; // ❌ Doesn't work in Workers
  // ...
}

export async function getUserSession(
  request: Request,
  kv: KVNamespace
): Promise<SessionData | null> {
  const sessionStorage = createSessionStorage(kv);
  // ...
}
```

#### After (Fixed):
```typescript
/**
 * Creates session storage backed by Cloudflare Workers KV
 * @param kv - KV namespace binding from context.cloudflare.env
 * @param env - Environment variables from context.cloudflare.env
 */
export function createSessionStorage(kv: KVNamespace, env: Env) {
  const COOKIE_SECRET = env.WORKOS_COOKIE_PASSWORD; // ✅ Works in Workers
  if (!COOKIE_SECRET || COOKIE_SECRET.length < 32) {
    throw new Error('WORKOS_COOKIE_PASSWORD must be at least 32 characters');
  }
  // ...
}

export async function getUserSession(
  request: Request,
  kv: KVNamespace,
  env: Env
): Promise<SessionData | null> {
  const sessionStorage = createSessionStorage(kv, env);
  // ...
}
```

**Changes:**
- Add `env: Env` parameter to `createSessionStorage()`
- Add `env: Env` parameter to `getUserSession()`
- Replace `process.env.WORKOS_COOKIE_PASSWORD` with `env.WORKOS_COOKIE_PASSWORD`
- Add validation for cookie secret length

**Reason:** Cloudflare Workers don't support `process.env` - environment variables must be accessed via `context.cloudflare.env`

---

## MODIFIED: Web Application Auth Functions

### File: `apps/web/app/lib/auth.server.ts`

#### Before (Broken):
```typescript
export async function authenticateWithPassword(
  email: string,
  password: string
): Promise<AuthResponse> {
  const workos = new WorkOS(process.env.WORKOS_API_KEY); // ❌ Doesn't work in Workers
  const clientId = process.env.WORKOS_CLIENT_ID;        // ❌ Doesn't work in Workers
  // ...
}

export async function createUser(
  email: string,
  password: string
): Promise<CreateUserResponse> {
  const workos = new WorkOS(process.env.WORKOS_API_KEY); // ❌ Doesn't work in Workers
  const clientId = process.env.WORKOS_CLIENT_ID;        // ❌ Doesn't work in Workers
  // ...
}

// Same pattern for all 8 auth functions:
// - verifyEmailCode
// - createPasswordReset
// - resetPassword
// - sendMagicAuthCode
// - authenticateWithMagicAuth
// - refreshAccessToken
// - logoutUser
```

#### After (Fixed):
```typescript
export async function authenticateWithPassword(
  email: string,
  password: string,
  env: Env
): Promise<AuthResponse> {
  const workos = new WorkOS(env.WORKOS_API_KEY); // ✅ Works in Workers
  const clientId = env.WORKOS_CLIENT_ID;         // ✅ Works in Workers
  // ...
}

export async function createUser(
  email: string,
  password: string,
  env: Env
): Promise<CreateUserResponse> {
  const workos = new WorkOS(env.WORKOS_API_KEY); // ✅ Works in Workers
  const clientId = env.WORKOS_CLIENT_ID;         // ✅ Works in Workers
  // ...
}

// All 8 auth functions updated with env parameter:
export async function verifyEmailCode(email: string, code: string, env: Env): Promise<AuthResponse>
export async function createPasswordReset(email: string, env: Env): Promise<void>
export async function resetPassword(token: string, newPassword: string, env: Env): Promise<void>
export async function sendMagicAuthCode(email: string, env: Env): Promise<void>
export async function authenticateWithMagicAuth(code: string, email: string, env: Env): Promise<AuthResponse>
export async function refreshAccessToken(refreshToken: string, env: Env): Promise<AuthResponse>
export async function logoutUser(userId: string, env: Env): Promise<void>
```

**Changes:**
- Add `env: Env` parameter to all 8 auth functions
- Replace all `process.env.WORKOS_API_KEY` with `env.WORKOS_API_KEY`
- Replace all `process.env.WORKOS_CLIENT_ID` with `env.WORKOS_CLIENT_ID`

**Impact:** All route handlers calling these functions must pass `context.cloudflare.env`

**Reason:** Cloudflare Workers require environment variables to be passed from request context

---

## MODIFIED: Web Application Dependencies

### File: `apps/web/package.json`

#### Before (Broken):
```json
{
  "dependencies": {
    "@workos-inc/node": "^7.x",
    "@tanstack/react-query": "^5.x"
    // ❌ Missing @react-router/cloudflare
  }
}
```

#### After (Fixed):
```json
{
  "dependencies": {
    "@workos-inc/node": "^7.x",
    "@react-router/cloudflare": "^7.x",  // ✅ Added for session storage
    "@tanstack/react-query": "^5.x"
  }
}
```

**Changes:**
- Add `@react-router/cloudflare` dependency

**Reason:** Required for `createWorkersKVSessionStorage()` used in session management

---

## MODIFIED: Web Application Configuration

### File: `apps/web/wrangler.toml`

#### Before (Broken):
```toml
name = "exchequer-web"
compatibility_date = "2024-01-01"

[vars]
WORKOS_CLIENT_ID = ""  # ❌ Empty client ID
API_URL = "http://localhost:3000"

# ❌ Missing KV namespace configuration
```

#### After (Fixed):
```toml
name = "exchequer-web"
compatibility_date = "2024-01-01"

[vars]
WORKOS_CLIENT_ID = "client_01HXYZ..."  # ✅ Valid client ID
API_URL = "http://localhost:3000"

# ✅ KV namespace for session storage
[[kv_namespaces]]
binding = "SESSION_KV"
id = "your-production-kv-namespace-id"
preview_id = "your-preview-kv-namespace-id"
```

**Changes:**
- Set `WORKOS_CLIENT_ID` to valid client ID value
- Add `[[kv_namespaces]]` configuration for session storage

**Reason:**
- Empty client ID causes WorkOS SDK calls to fail
- KV namespace required for session storage to work

**Action Required:** Create KV namespaces in Cloudflare dashboard and replace placeholder IDs

---

## MODIFIED: API JWKS Configuration

### File: `apps/api/src/auth.ts`

#### Before (Broken):
```typescript
export async function registerAuth(
  server: FastifyInstance,
  options?: AuthOptions
): Promise<void> {
  const clientId = config.workosClientId;

  // ❌ Incorrect JWKS URL - includes client ID in path
  const JWKS = createRemoteJWKSet(
    new URL(`https://api.workos.com/sso/jwks/${clientId}`)
  );

  // ...
}
```

#### After (Fixed):
```typescript
export async function registerAuth(
  server: FastifyInstance,
  options?: AuthOptions
): Promise<void> {
  const clientId = config.workosClientId;

  // ✅ Correct JWKS URL - WorkOS uses standard endpoint
  const JWKS = createRemoteJWKSet(
    new URL('https://api.workos.com/sso/jwks')
  );

  // Configure JWT verification with proper issuer/audience
  const verifyOptions = {
    issuer: `https://api.workos.com/sso/v1/${clientId}`,
    audience: clientId,
  };

  // ...
}
```

**Changes:**
- Fix JWKS URL from `https://api.workos.com/sso/jwks/${clientId}` to `https://api.workos.com/sso/jwks`
- Add issuer and audience validation configuration

**Reason:** WorkOS uses a single JWKS endpoint for all clients, not client-specific URLs. The client ID is validated via the `aud` claim.

**Reference:** [WorkOS JWT Verification Docs](https://workos.com/docs/user-management/jwt-verification)

---

## MODIFIED: API Configuration Validation

### File: `apps/api/src/config.ts`

#### Before (Broken):
```typescript
export const config = {
  workosClientId: env.WORKOS_CLIENT_ID || '',  // ❌ No validation
  // ...
};
```

#### After (Fixed):
```typescript
/**
 * Validates that a required environment variable is set
 * @throws {Error} if the environment variable is missing or empty
 */
function validateRequiredEnv(key: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      `Please set ${key} in your .env file.`
    );
  }
  return value;
}

export const config = {
  workosClientId: validateRequiredEnv('WORKOS_CLIENT_ID', env.WORKOS_CLIENT_ID),  // ✅ Validated
  // ...
};
```

**Changes:**
- Add `validateRequiredEnv()` helper function
- Use validation for `WORKOS_CLIENT_ID`
- Throw descriptive error if missing

**Reason:** Fail fast on startup if required configuration is missing, rather than silently failing during JWT verification

---

## MODIFIED: API Error Response Titles

### File: `apps/api/src/errors.ts`

#### Before (Broken):
```typescript
function getErrorTitle(statusCode: number): string {
  switch (statusCode) {
    case 400: return 'Bad Request';
    case 401: return 'Invalid Request';    // ❌ Wrong title
    case 403: return 'Invalid Request';    // ❌ Wrong title
    case 404: return 'Not Found';
    case 409: return 'Conflict';
    case 422: return 'Unprocessable Entity';
    case 429: return 'Invalid Request';    // ❌ Wrong title
    case 500: return 'Internal Server Error';
    default: return 'Error';
  }
}
```

#### After (Fixed):
```typescript
function getErrorTitle(statusCode: number): string {
  switch (statusCode) {
    case 400: return 'Bad Request';
    case 401: return 'Unauthorized';           // ✅ Correct
    case 403: return 'Forbidden';              // ✅ Correct
    case 404: return 'Not Found';
    case 409: return 'Conflict';
    case 422: return 'Unprocessable Entity';
    case 429: return 'Too Many Requests';      // ✅ Correct
    case 500: return 'Internal Server Error';
    default: return 'Error';
  }
}
```

**Changes:**
- Fix 401 title: "Invalid Request" → "Unauthorized"
- Fix 403 title: "Invalid Request" → "Forbidden"
- Fix 429 title: "Invalid Request" → "Too Many Requests"

**Reason:** Error response titles should match HTTP status code semantics for proper API design

---

## MODIFIED: Specification - Known Issues Section

### File: `docs/spec/auth/spec.md`

#### Location: After "Implementation Notes" section (line 604)

```markdown
### Known Issues (Fixed in workos-fix)

**Prior to Fix (2026-01-20):**

The implementation had critical bugs preventing production use:

**Web Application Issues:**
- ❌ Missing `@react-router/cloudflare` dependency (session storage failed to initialize)
- ❌ Used `process.env` which doesn't work in Cloudflare Workers (all auth functions failed)
- ❌ KV namespace not configured in `wrangler.toml` (session operations failed)
- ❌ `WORKOS_CLIENT_ID` empty in configuration (WorkOS SDK calls failed)

**API Issues:**
- ❌ JWKS URL incorrectly included client ID in path (JWT verification returned 404)
- ❌ No validation for missing `WORKOS_CLIENT_ID` (silent failures during JWT verification)
- ❌ Incorrect error response titles (poor API semantics)

**Status:** Fixed in change proposal `workos-fix` (2026-01-20)

**Post-Fix State:**
- ✅ All Cloudflare Workers compatibility issues resolved
- ✅ JWKS URL corrected to WorkOS standard endpoint
- ✅ Configuration validation added for fail-fast on startup
- ✅ Error response titles corrected to HTTP standards
```

---

## Summary of Changes

| Component | File | Change Type | Lines Changed |
|-----------|------|-------------|---------------|
| Web Session | `apps/web/app/lib/session.server.ts` | Refactor | ~20 |
| Web Auth | `apps/web/app/lib/auth.server.ts` | Refactor | ~50 |
| Web Dependencies | `apps/web/package.json` | Add | 1 |
| Web Config | `apps/web/wrangler.toml` | Update | ~10 |
| API Auth | `apps/api/src/auth.ts` | Fix | ~5 |
| API Config | `apps/api/src/config.ts` | Add | ~10 |
| API Errors | `apps/api/src/errors.ts` | Fix | 3 |
| Spec | `docs/spec/auth/spec.md` | Document | ~20 |

**Total:** 7 files modified, ~118 lines changed

---

## Migration Path

### For Developers:
1. Pull latest code with fixes
2. Run `bun install` in `apps/web` (installs new dependency)
3. Create KV namespaces in Cloudflare dashboard
4. Update `apps/web/wrangler.toml` with KV namespace IDs
5. Set valid `WORKOS_CLIENT_ID` in `wrangler.toml` and `apps/api/.env`
6. Run integration tests to verify auth flows work
7. Deploy to Cloudflare Workers preview environment
8. Test end-to-end authentication flow

### For CI/CD:
1. Add KV namespace IDs as secrets
2. Add `WORKOS_CLIENT_ID` as secret
3. Update deployment scripts to configure `wrangler.toml` dynamically
4. Add integration tests to CI pipeline

---

## Testing Requirements

### Unit Tests (No Changes Required)
Existing unit tests continue to work - they mock the environment variables.

### Integration Tests (Updates Required)

**Web Application:**
```typescript
// Update test setup to pass env parameter
const mockEnv = {
  WORKOS_API_KEY: 'test_key',
  WORKOS_CLIENT_ID: 'client_test',
  WORKOS_COOKIE_PASSWORD: 'test_password_32_characters_long',
};

// All auth function calls now need env parameter
await authenticateWithPassword('test@example.com', 'password', mockEnv);
```

**API:**
```typescript
// Test JWKS URL is correct
expect(JWKS_URL).toBe('https://api.workos.com/sso/jwks');
expect(JWKS_URL).not.toContain('client_');

// Test config validation throws on missing WORKOS_CLIENT_ID
expect(() => loadConfig({ WORKOS_CLIENT_ID: '' })).toThrow('Missing required environment variable');
```

### End-to-End Tests (New)
1. Deploy to Cloudflare Workers preview
2. Test signup → verify email → login flow
3. Test API call through proxy with JWT
4. Test session persistence
5. Test token refresh on expiration
