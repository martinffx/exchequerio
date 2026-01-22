# Technical Design: Fix WorkOS Authentication Implementation

## Current State (Baseline)

The authentication system is documented in `docs/spec/auth/spec.md` with the following architecture:

### Web Application Current Implementation
- **Session Management** (`app/lib/session.server.ts`):
  - Uses `createWorkersKVSessionStorage()` from `@react-router/cloudflare`
  - Accesses `process.env.WORKOS_COOKIE_PASSWORD` directly (line 21)
  - Function signature: `createSessionStorage(kv: KVNamespace)`

- **Auth Functions** (`app/lib/auth.server.ts`):
  - 8 authentication functions using WorkOS SDK
  - All functions access `process.env` via lazy initialization in `getWorkOSClient()` (lines 14-20)
  - Function signatures accept no environment parameters

- **Configuration** (`wrangler.toml`):
  - `WORKOS_CLIENT_ID = ""` (empty string, line 19)
  - KV namespace binding exists but `id` and `preview_id` are commented out (lines 11, 15)

- **Dependencies** (`package.json`):
  - Missing `@react-router/cloudflare` package

### API Current Implementation
- **Auth Module** (`src/auth.ts`):
  - JWKS URL: `https://api.workos.com/sso/jwks/${server.config.workosClientId}` (line 153)
  - No validation that `workosClientId` is set

- **Config Module** (`src/config.ts`):
  - `workosClientId` defaults to empty string if env var missing (line 13)
  - No validation that required env vars are set

- **Error Responses** (`src/errors.ts`):
  - `UnauthorizedError` (401): `title: "Bad Request"` (line 65)
  - `ForbiddenError` (403): `title: "Bad Request"` (line 84)
  - Incorrect HTTP semantics in error response titles

## Proposed Changes

### Layer 1: Web Application - Dependency Management

**File:** `apps/web/package.json`

**Change Type:** ADDED

**Modification:**
```json
{
  "dependencies": {
    "@react-router/cloudflare": "^7.0.0"
  }
}
```

**Rationale:** Required for `createWorkersKVSessionStorage()` function used in session.server.ts

---

### Layer 2: Web Application - Session Management

**File:** `apps/web/app/lib/session.server.ts`

**Change Type:** MODIFIED

**Current Implementation:**
```typescript
export function createSessionStorage(kv: KVNamespace) {
  return createWorkersKVSessionStorage<SessionData>({
    kv,
    cookie: {
      name: "workos_session",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      secrets: [process.env.WORKOS_COOKIE_PASSWORD!], // ❌ Line 21
      maxAge: 60 * 60 * 24 * 7,
    },
  });
}

export async function getUserSession(
  request: Request,
  kv: KVNamespace
): Promise<SessionData | null> {
  const { getSession } = createSessionStorage(kv); // ❌ Missing env parameter
  // ...
}
```

**Proposed Implementation:**
```typescript
export function createSessionStorage(kv: KVNamespace, env: Env) {
  return createWorkersKVSessionStorage<SessionData>({
    kv,
    cookie: {
      name: "workos_session",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      secrets: [env.WORKOS_COOKIE_PASSWORD], // ✅ Use env parameter
      maxAge: 60 * 60 * 24 * 7,
    },
  });
}

export async function getUserSession(
  request: Request,
  kv: KVNamespace,
  env: Env // ✅ Add env parameter
): Promise<SessionData | null> {
  const { getSession } = createSessionStorage(kv, env); // ✅ Pass env
  // ...
}
```

**Type Definition Required:**
```typescript
// Add to app/lib/types.ts
export type Env = {
  SESSION_KV: KVNamespace;
  WORKOS_API_KEY: string;
  WORKOS_CLIENT_ID: string;
  WORKOS_COOKIE_PASSWORD: string;
  API_URL: string;
};
```

**Impact:**
- **Breaking Change:** Yes - All callers must pass `env` parameter
- **Files Affected:** All route files calling `getUserSession()` or `createSessionStorage()`

---

### Layer 3: Web Application - Authentication Functions

**File:** `apps/web/app/lib/auth.server.ts`

**Change Type:** MODIFIED

**Current Implementation:**
```typescript
let workos: WorkOS | null = null;
let clientId: string | null = null;

function getWorkOSClient() {
  if (!workos) {
    workos = new WorkOS(process.env.WORKOS_API_KEY); // ❌ Line 16
    clientId = process.env.WORKOS_CLIENT_ID || ""; // ❌ Line 17
  }
  return { workos, clientId: clientId! };
}

export async function authenticateWithPassword(
  email: string,
  password: string
): Promise<AuthResponse> {
  const { workos, clientId } = getWorkOSClient(); // ❌ No env
  // ...
}

// Similar pattern for 7 other auth functions...
```

**Proposed Implementation:**
```typescript
// ✅ Remove module-level state
function getWorkOSClient(env: Env) {
  return {
    workos: new WorkOS(env.WORKOS_API_KEY),
    clientId: env.WORKOS_CLIENT_ID,
  };
}

export async function authenticateWithPassword(
  email: string,
  password: string,
  env: Env // ✅ Add env parameter
): Promise<AuthResponse> {
  const { workos, clientId } = getWorkOSClient(env); // ✅ Pass env
  // ...
}

// Apply same pattern to all 8 auth functions:
export async function createUser(email: string, password: string, env: Env): Promise<CreateUserResponse>
export async function verifyEmailCode(email: string, code: string, env: Env): Promise<AuthResponse>
export async function createPasswordReset(email: string, env: Env): Promise<void>
export async function resetPassword(token: string, newPassword: string, env: Env): Promise<void>
export async function sendMagicAuthCode(email: string, env: Env): Promise<void>
export async function authenticateWithMagicAuth(code: string, email: string, env: Env): Promise<AuthResponse>
export async function refreshAccessToken(refreshToken: string, env: Env): Promise<AuthResponse>
export async function logoutUser(userId: string, env: Env): Promise<void>
```

**Impact:**
- **Breaking Change:** Yes - All 8 functions require `env` parameter
- **Files Affected:** All route files calling any auth function (~7 route files)

---

### Layer 4: Web Application - Route Updates

**Files Affected:**
- `app/routes/login.tsx`
- `app/routes/signup.tsx`
- `app/routes/logout.tsx`
- `app/routes/verify-email.tsx`
- `app/routes/forgot-password.tsx`
- `app/routes/reset-password.tsx`
- `app/routes/magic-link.tsx`
- `app/routes/api.$.tsx` (API proxy)

**Change Type:** MODIFIED

**Pattern for All Routes:**

**Current:**
```typescript
export async function action({ request, context }: Route.ActionArgs) {
  const session = await getUserSession(request, context.cloudflare.env.SESSION_KV);
  const result = await authenticateWithPassword(email, password);
  // ...
}
```

**Proposed:**
```typescript
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const session = await getUserSession(request, env.SESSION_KV, env);
  const result = await authenticateWithPassword(email, password, env);
  // ...
}
```

**Example for API Proxy:**

**Current:**
```typescript
// app/routes/api.$.tsx
export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await getUserSession(request, context.cloudflare.env.SESSION_KV);

  if (isTokenExpired(session.accessToken)) {
    const refreshed = await refreshAccessToken(session.refreshToken);
    // Update session...
  }
  // Forward request...
}
```

**Proposed:**
```typescript
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const session = await getUserSession(request, env.SESSION_KV, env);

  if (isTokenExpired(session.accessToken)) {
    const refreshed = await refreshAccessToken(session.refreshToken, env);
    // Update session...
  }
  // Forward request...
}
```

**Impact:**
- **Breaking Change:** No (internal implementation)
- **Files Modified:** ~8 route files

---

### Layer 5: Web Application - Configuration

**File:** `apps/web/wrangler.toml`

**Change Type:** MODIFIED

**Current Configuration:**
```toml
[[kv_namespaces]]
binding = "SESSION_KV"
# TODO: Create KV namespace in Cloudflare dashboard and add ID here
# Run: wrangler kv:namespace create "SESSION_KV"
# id = "<production-kv-id>"

# Preview KV namespace for development
# Run: wrangler kv:namespace create "SESSION_KV" --preview
# preview_id = "<preview-kv-id>"

[vars]
API_URL = "http://localhost:3000"
WORKOS_CLIENT_ID = ""
```

**Proposed Configuration:**
```toml
[[kv_namespaces]]
binding = "SESSION_KV"
id = "your-production-kv-id"      # ✅ Replace with actual ID
preview_id = "your-preview-kv-id"  # ✅ Replace with actual ID

[vars]
API_URL = "http://localhost:3000"
WORKOS_CLIENT_ID = "client_01HXYZ..."  # ✅ Set actual client ID
```

**Prerequisites:**
1. Create production KV namespace: `wrangler kv:namespace create "SESSION_KV"`
2. Create preview KV namespace: `wrangler kv:namespace create "SESSION_KV" --preview`
3. Copy IDs from command output to `wrangler.toml`
4. Obtain WorkOS Client ID from WorkOS dashboard

**Impact:**
- **Breaking Change:** No (configuration only)
- **Manual Steps Required:** Yes (KV namespace creation)

---

### Layer 6: API - JWKS URL Fix

**File:** `apps/api/src/auth.ts`

**Change Type:** MODIFIED

**Current Implementation:**
```typescript
const registerAuth = async (server: FastifyInstance, options: AuthOptions = {}): Promise<void> => {
  const JWKS =
    options.jwks ??
    createRemoteJWKSet(new URL(`https://api.workos.com/sso/jwks/${server.config.workosClientId}`)); // ❌ Line 153
  // ...
}
```

**Proposed Implementation:**
```typescript
const registerAuth = async (server: FastifyInstance, options: AuthOptions = {}): Promise<void> => {
  const JWKS =
    options.jwks ??
    createRemoteJWKSet(new URL('https://api.workos.com/sso/jwks')); // ✅ Remove client ID from path
  // ...
}
```

**Rationale:**
- WorkOS JWKS endpoint does not use client ID in URL path
- Client ID is validated via JWT `audience` claim (already implemented on line 169)

**Impact:**
- **Breaking Change:** No (bug fix)
- **Files Modified:** 1

---

### Layer 7: API - Configuration Validation

**File:** `apps/api/src/config.ts`

**Change Type:** MODIFIED

**Current Implementation:**
```typescript
class Config {
  public readonly databaseUrl: string;
  public readonly workosClientId: string;
  public readonly environment: string;

  constructor({ databaseUrl, workosClientId, environment }: ConfigOptions = {}) {
    this.databaseUrl = databaseUrl ?? process.env.DATABASE_URL ?? "";
    this.workosClientId = workosClientId ?? process.env.WORKOS_CLIENT_ID ?? ""; // ❌ Allows empty
    this.environment = environment ?? process.env.NODE_ENV ?? "development";
  }
}
```

**Proposed Implementation:**
```typescript
class Config {
  public readonly databaseUrl: string;
  public readonly workosClientId: string;
  public readonly environment: string;

  constructor({ databaseUrl, workosClientId, environment }: ConfigOptions = {}) {
    this.databaseUrl = databaseUrl ?? process.env.DATABASE_URL ?? "";
    this.workosClientId = this.validateRequired(
      'WORKOS_CLIENT_ID',
      workosClientId ?? process.env.WORKOS_CLIENT_ID
    ); // ✅ Validate required
    this.environment = environment ?? process.env.NODE_ENV ?? "development";
  }

  private validateRequired(name: string, value: string | undefined): string {
    if (!value || value.trim() === '') {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  }
}
```

**Impact:**
- **Breaking Change:** Yes (fail-fast behavior added)
- **Benefit:** API refuses to start without valid configuration
- **Files Modified:** 1

---

### Layer 8: API - Error Response Titles

**File:** `apps/api/src/errors.ts`

**Change Type:** MODIFIED

**Current Implementation:**
```typescript
class UnauthorizedError extends LedgerError {
  public readonly status = 401;

  public toResponse(): UnauthorizedErrorResponse {
    return {
      type: "UNAUTHORIZED",
      status: this.status,
      title: "Bad Request", // ❌ Line 65 - Wrong title
      detail: this.message,
      instance: `/instance/${uuid()}`,
      traceId: uuid(),
    };
  }
}

class ForbiddenError extends LedgerError {
  public readonly status = 403;

  public toResponse(): ForbiddenErrorResponse {
    return {
      type: "FORBIDDEN",
      status: this.status,
      title: "Bad Request", // ❌ Line 84 - Wrong title
      detail: this.message,
      instance: `/instance/${uuid()}`,
      traceId: uuid(),
    };
  }
}
```

**Proposed Implementation:**
```typescript
class UnauthorizedError extends LedgerError {
  public readonly status = 401;

  public toResponse(): UnauthorizedErrorResponse {
    return {
      type: "UNAUTHORIZED",
      status: this.status,
      title: "Unauthorized", // ✅ Correct HTTP semantics
      detail: this.message,
      instance: `/instance/${uuid()}`,
      traceId: uuid(),
    };
  }
}

class ForbiddenError extends LedgerError {
  public readonly status = 403;

  public toResponse(): ForbiddenErrorResponse {
    return {
      type: "FORBIDDEN",
      status: this.status,
      title: "Forbidden", // ✅ Correct HTTP semantics
      detail: this.message,
      instance: `/instance/${uuid()}`,
      traceId: uuid(),
    };
  }
}
```

**Additional Error Classes to Check:**
- `TooManyRequestsError` (429) - Verify title is "Too Many Requests"

**Impact:**
- **Breaking Change:** No (error message improvement)
- **Files Modified:** 1

---

## Migration Strategy

### Phase 1: Dependency Installation (5 minutes)
```bash
# Web application
cd apps/web
bun add @react-router/cloudflare
```

### Phase 2: Infrastructure Setup (5 minutes)
```bash
# Create KV namespaces
wrangler kv:namespace create "SESSION_KV"
wrangler kv:namespace create "SESSION_KV" --preview

# Update wrangler.toml with IDs from output
# Set WORKOS_CLIENT_ID in wrangler.toml
```

### Phase 3: Code Updates - Web Application (60 minutes)

**Order of changes (dependency-driven):**

1. **Create Type Definition** (`app/lib/types.ts`)
   - Add `Env` type export

2. **Update Session Module** (`app/lib/session.server.ts`)
   - Add `env` parameter to `createSessionStorage()`
   - Add `env` parameter to `getUserSession()`

3. **Update Auth Module** (`app/lib/auth.server.ts`)
   - Refactor `getWorkOSClient()` to accept `env`
   - Add `env` parameter to all 8 auth functions

4. **Update Routes** (8 files)
   - Extract `env` from `context.cloudflare.env`
   - Pass `env` to all auth and session function calls

### Phase 4: Code Updates - API (15 minutes)

**Order of changes:**

1. **Update Config** (`src/config.ts`)
   - Add `validateRequired()` method
   - Apply validation to `workosClientId`

2. **Fix JWKS URL** (`src/auth.ts`)
   - Remove `${server.config.workosClientId}` from JWKS URL

3. **Fix Error Titles** (`src/errors.ts`)
   - Update `UnauthorizedError` title
   - Update `ForbiddenError` title
   - Verify `TooManyRequestsError` title

### Phase 5: Testing (60 minutes)

**Unit Tests:**
- Session module: `createSessionStorage()` accepts env parameter
- Auth module: All functions accept env parameter
- Config module: Throws error on missing `WORKOS_CLIENT_ID`

**Integration Tests:**
- Web: Full login flow (signup → verify → login)
- Web: Session persistence across requests
- Web: API proxy with JWT injection
- Web: Token refresh on expiration
- API: JWT verification with valid token
- API: 401 on invalid/expired token

**End-to-End Tests:**
- Deploy to Cloudflare Workers preview environment
- Verify authentication flows work
- Verify API calls succeed with JWT
- Verify error responses have correct titles

---

## Breaking Changes

### Web Application

**Session Functions:**
- `createSessionStorage(kv)` → `createSessionStorage(kv, env)`
- `getUserSession(request, kv)` → `getUserSession(request, kv, env)`

**Auth Functions (all 8):**
- `authenticateWithPassword(email, password)` → `authenticateWithPassword(email, password, env)`
- `createUser(email, password)` → `createUser(email, password, env)`
- `verifyEmailCode(email, code)` → `verifyEmailCode(email, code, env)`
- `createPasswordReset(email)` → `createPasswordReset(email, env)`
- `resetPassword(token, newPassword)` → `resetPassword(token, newPassword, env)`
- `sendMagicAuthCode(email)` → `sendMagicAuthCode(email, env)`
- `authenticateWithMagicAuth(code, email)` → `authenticateWithMagicAuth(code, email, env)`
- `refreshAccessToken(refreshToken)` → `refreshAccessToken(refreshToken, env)`
- `logoutUser(userId)` → `logoutUser(userId, env)`

### API

**Configuration:**
- API now fails to start if `WORKOS_CLIENT_ID` is missing or empty
- Previously: Started with empty string, JWT verification failed silently
- Now: Explicit error on startup

**Error Responses:**
- 401 title changed from "Bad Request" to "Unauthorized"
- 403 title changed from "Bad Request" to "Forbidden"
- No functional impact (error structure unchanged)

---

## Rollback Strategy

### If Issues Found in Testing

**Revert Git Commit:**
```bash
git revert <commit-hash>
git push
```

**Redeploy Previous Version:**
```bash
# Web
cd apps/web
wrangler deploy --rollback

# API (if using Cloudflare Workers)
cd apps/api
wrangler deploy --rollback
```

### Manual Rollback Steps

1. Revert code changes via git
2. Redeploy previous version
3. KV namespaces can remain (no schema changes)
4. No database migrations to rollback

---

## Testing Strategy

### Unit Tests

**Web Application:**

File: `apps/web/app/lib/session.server.test.ts`
```typescript
describe('createSessionStorage', () => {
  it('should use env.WORKOS_COOKIE_PASSWORD for cookie secret', () => {
    const mockKV = {} as KVNamespace;
    const mockEnv = { WORKOS_COOKIE_PASSWORD: 'test-secret-32-characters-long' };

    const storage = createSessionStorage(mockKV, mockEnv);

    expect(storage).toBeDefined();
  });
});
```

File: `apps/web/app/lib/auth.server.test.ts`
```typescript
describe('authenticateWithPassword', () => {
  it('should use env.WORKOS_API_KEY and env.WORKOS_CLIENT_ID', async () => {
    const mockEnv = {
      WORKOS_API_KEY: 'sk_test_...',
      WORKOS_CLIENT_ID: 'client_...',
    };

    // Mock WorkOS SDK response
    const result = await authenticateWithPassword('test@example.com', 'password', mockEnv);

    expect(result).toHaveProperty('accessToken');
  });
});
```

**API:**

File: `apps/api/src/config.test.ts`
```typescript
describe('Config', () => {
  it('should throw error when WORKOS_CLIENT_ID is missing', () => {
    expect(() => {
      new Config({ workosClientId: '' });
    }).toThrow('Missing required environment variable: WORKOS_CLIENT_ID');
  });

  it('should throw error when WORKOS_CLIENT_ID is whitespace', () => {
    expect(() => {
      new Config({ workosClientId: '   ' });
    }).toThrow('Missing required environment variable: WORKOS_CLIENT_ID');
  });
});
```

File: `apps/api/src/auth.test.ts`
```typescript
describe('JWKS URL', () => {
  it('should use correct WorkOS JWKS endpoint without client ID in path', async () => {
    // Verify JWKS URL is 'https://api.workos.com/sso/jwks'
    // Not 'https://api.workos.com/sso/jwks/{clientId}'
  });
});
```

File: `apps/api/src/errors.test.ts`
```typescript
describe('Error response titles', () => {
  it('UnauthorizedError should return title "Unauthorized"', () => {
    const error = new UnauthorizedError('Test');
    expect(error.toResponse().title).toBe('Unauthorized');
  });

  it('ForbiddenError should return title "Forbidden"', () => {
    const error = new ForbiddenError('Test');
    expect(error.toResponse().title).toBe('Forbidden');
  });
});
```

### Integration Tests

**Web Application:**

File: `apps/web/app/routes/login.test.ts`
```typescript
describe('Login flow', () => {
  it('should authenticate and create session', async () => {
    // Mock WorkOS authentication
    // Submit login form
    // Verify session created in KV
    // Verify redirect to dashboard
  });
});
```

**API:**

File: `apps/api/src/auth.integration.test.ts`
```typescript
describe('JWT verification', () => {
  it('should verify valid WorkOS JWT', async () => {
    // Create test server with auth
    // Make request with valid JWT
    // Verify 200 response
    // Verify request.user populated
  });

  it('should reject invalid JWKS signature', async () => {
    // Create test server
    // Make request with invalid JWT
    // Verify 401 response
    // Verify error title is "Unauthorized"
  });
});
```

### End-to-End Tests

**Full Authentication Flow:**
```typescript
describe('E2E: Authentication', () => {
  it('should complete full signup and login flow', async () => {
    // 1. Visit signup page
    // 2. Submit signup form
    // 3. Verify email with code
    // 4. Verify session created
    // 5. Make API request through proxy
    // 6. Verify JWT in Authorization header
    // 7. Verify API returns 200
  });
});
```

---

## Success Criteria

### Functional Requirements
- [ ] Web app starts without "process is not defined" errors
- [ ] All 8 auth functions accept and use `env` parameter
- [ ] Session storage accepts and uses `env` parameter
- [ ] All route handlers pass `context.cloudflare.env` to auth/session functions
- [ ] API starts successfully with valid `WORKOS_CLIENT_ID`
- [ ] API fails to start with error if `WORKOS_CLIENT_ID` missing
- [ ] JWT verification succeeds with correct JWKS URL
- [ ] Error responses have correct HTTP titles (401, 403, 429)

### Testing Requirements
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] E2E test completes full auth flow
- [ ] Web app deploys to Cloudflare Workers successfully
- [ ] API starts and verifies JWTs in production

### Performance Requirements
- [ ] JWT verification latency < 5ms (cached JWKS)
- [ ] Session retrieval from KV < 10ms
- [ ] No regression in existing performance metrics

### Security Requirements
- [ ] JWT never exposed to browser (stays server-side)
- [ ] Cookie secret properly encrypted
- [ ] JWKS signature verification works
- [ ] Organization ID validation works
- [ ] Permission enforcement works

---

## Estimated Effort

| Phase | Estimated Time |
|-------|---------------|
| Dependency installation | 5 minutes |
| Infrastructure setup (KV namespaces) | 5 minutes |
| Web code updates | 60 minutes |
| API code updates | 15 minutes |
| Unit test updates | 30 minutes |
| Integration test updates | 30 minutes |
| E2E testing | 30 minutes |
| **Total** | **2.75 hours** |

---

## Dependencies and Risks

### External Dependencies
- Cloudflare Workers KV namespace creation (manual step)
- WorkOS Client ID from WorkOS dashboard (manual step)
- `@react-router/cloudflare` package availability

### Technical Risks
- **Risk:** Migration breaks existing route handlers
  - **Mitigation:** Update all routes simultaneously, comprehensive testing

- **Risk:** KV namespace IDs incorrectly configured
  - **Mitigation:** Validate with test deployment before production

- **Risk:** WorkOS JWKS endpoint URL still incorrect
  - **Mitigation:** Verify with WorkOS documentation, test with real JWT

### Deployment Risks
- **Risk:** Environment variables not set in production
  - **Mitigation:** Config validation fails fast, prevents silent failures

- **Risk:** Session migration during deployment
  - **Mitigation:** No session schema changes, existing sessions continue to work

---

## Open Questions

1. **KV Namespace IDs:** What are the production and preview KV namespace IDs?
   - **Answer:** Create via `wrangler kv:namespace create` commands

2. **WorkOS Client ID:** What is the production WorkOS Client ID?
   - **Answer:** Obtain from WorkOS dashboard

3. **CI/CD Updates:** Should we add lint rule to prevent `process.env` in Workers code?
   - **Recommendation:** Yes, add ESLint rule for Workers context

4. **Testing Infrastructure:** Do we need Cloudflare Workers test environment?
   - **Recommendation:** Use `miniflare` for local testing with KV

5. **Backward Compatibility:** Should we support both old and new function signatures?
   - **Recommendation:** No, clean break with comprehensive update
