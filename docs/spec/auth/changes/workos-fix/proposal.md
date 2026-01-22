# Change Proposal: Fix WorkOS Authentication Implementation

## Metadata
- **Feature**: Authentication & Authorization
- **Type**: Bug Fix
- **Priority**: Critical
- **Created**: 2026-01-20
- **Status**: Proposed

## Motivation

The WorkOS authentication implementation documented in `docs/spec/auth/spec.md` has **critical bugs preventing it from working in production**. Despite being marked as "fully implemented and tested," the code contains multiple blocking issues:

### Critical Issues

1. **Missing Dependency** (`apps/web/package.json`)
   - `@react-router/cloudflare` dependency not installed
   - Session storage fails to initialize without this package
   - Impact: Web app crashes on startup

2. **Cloudflare Workers Incompatibility** (`apps/web/app/lib/auth.server.ts`, `session.server.ts`)
   - Code uses `process.env` which doesn't exist in Cloudflare Workers runtime
   - Workers use `context.cloudflare.env` instead
   - Impact: All authentication functions fail with "process is not defined"

3. **Incorrect JWKS URL** (`apps/api/src/auth.ts:153`)
   - Current: `https://api.workos.com/sso/jwks/${clientId}`
   - Correct: `https://api.workos.com/sso/jwks`
   - Impact: JWT verification fails with 404 from WorkOS API

4. **Missing KV Namespace Configuration** (`apps/web/wrangler.toml`)
   - No `[[kv_namespaces]]` binding defined for SESSION_KV
   - Impact: Session storage operations fail

5. **Empty Client ID** (`apps/web/wrangler.toml`)
   - `WORKOS_CLIENT_ID = ""`
   - Impact: WorkOS SDK calls fail with invalid client ID

### Secondary Issues

6. **Missing Config Validation** (`apps/api/src/config.ts`)
   - No validation that WORKOS_CLIENT_ID is set
   - Impact: API starts without failing fast, silent failures in JWT verification

7. **Incorrect Error Response Titles** (`apps/api/src/errors.ts`)
   - 401: "Invalid Request" (should be "Unauthorized")
   - 403: "Invalid Request" (should be "Forbidden")
   - 429: "Invalid Request" (should be "Too Many Requests")
   - Impact: Poor API error semantics, confusing for API consumers

8. **Auth Functions Don't Accept Context** (`apps/web/app/lib/auth.server.ts`)
   - All auth functions use `process.env` internally
   - Cloudflare Workers require env to be passed from request context
   - Impact: Cannot access environment variables in Workers runtime

## Impact Analysis

### User Impact
- **Current State**: Authentication completely broken - users cannot sign up, log in, or access protected routes
- **After Fix**: Full authentication functionality working as designed
- **Breaking Changes**: None (nothing currently works)

### System Impact
- **Web App**: 4 critical fixes + 1 configuration change
- **API**: 2 fixes (JWKS URL + config validation + error titles)
- **Database**: No changes required
- **Infrastructure**: Requires KV namespace creation in Cloudflare

### Code Impact
| Component | Files Modified | Lines Changed (Est.) |
|-----------|----------------|---------------------|
| Web - Session | 1 | ~20 |
| Web - Auth | 1 | ~50 |
| Web - Config | 2 | ~15 |
| API - Auth | 1 | ~5 |
| API - Config | 1 | ~10 |
| API - Errors | 1 | ~3 |
| **Total** | **7** | **~103** |

### Risk Assessment
- **Risk Level**: Low (fixing broken functionality)
- **Deployment Risk**: Low (can deploy incrementally)
- **Rollback Strategy**: Git revert
- **Testing Required**: Integration tests for full auth flows

## Implementation Approach

### Phase 1: Web App Fixes (Critical)

#### 1. Add Missing Dependency
```bash
cd apps/web
bun add @react-router/cloudflare
```

#### 2. Refactor Session Storage (`session.server.ts`)
**Before:**
```typescript
function createSessionStorage(kv: KVNamespace) {
  const COOKIE_SECRET = process.env.WORKOS_COOKIE_PASSWORD;
  // ...
}
```

**After:**
```typescript
function createSessionStorage(kv: KVNamespace, env: Env) {
  const COOKIE_SECRET = env.WORKOS_COOKIE_PASSWORD;
  // ...
}
```

**Changes:**
- Add `env: Env` parameter to `createSessionStorage()`
- Add `env: Env` parameter to `getUserSession()`
- Update all callers to pass `context.cloudflare.env`

#### 3. Refactor Auth Functions (`auth.server.ts`)
**Before:**
```typescript
export async function authenticateWithPassword(email: string, password: string) {
  const workos = new WorkOS(process.env.WORKOS_API_KEY);
  // ...
}
```

**After:**
```typescript
export async function authenticateWithPassword(email: string, password: string, env: Env) {
  const workos = new WorkOS(env.WORKOS_API_KEY);
  // ...
}
```

**Changes:**
- Add `env: Env` parameter to all 8 auth functions
- Replace all `process.env` with `env` parameter
- Update route handlers to pass `context.cloudflare.env`

#### 4. Configure KV Namespace (`wrangler.toml`)
```toml
[[kv_namespaces]]
binding = "SESSION_KV"
id = "your-kv-namespace-id-here"
preview_id = "your-preview-kv-namespace-id-here"
```

**Action Required:** Create KV namespaces in Cloudflare dashboard first

#### 5. Set Client ID (`wrangler.toml`)
```toml
[vars]
WORKOS_CLIENT_ID = "client_01HXYZ..."  # Replace with actual client ID
```

### Phase 2: API Fixes

#### 1. Fix JWKS URL (`apps/api/src/auth.ts:153`)
**Before:**
```typescript
const JWKS = createRemoteJWKSet(
  new URL(`https://api.workos.com/sso/jwks/${clientId}`)
);
```

**After:**
```typescript
const JWKS = createRemoteJWKSet(
  new URL('https://api.workos.com/sso/jwks')
);
```

#### 2. Add Config Validation (`apps/api/src/config.ts`)
**Before:**
```typescript
export const config = {
  workosClientId: env.WORKOS_CLIENT_ID || '',
  // ...
};
```

**After:**
```typescript
function validateRequiredEnv(key: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  workosClientId: validateRequiredEnv('WORKOS_CLIENT_ID', env.WORKOS_CLIENT_ID),
  // ...
};
```

#### 3. Fix Error Response Titles (`apps/api/src/errors.ts`)
```typescript
// Update error factory function
case 401: title = 'Unauthorized'; break;
case 403: title = 'Forbidden'; break;
case 429: title = 'Too Many Requests'; break;
```

### Phase 3: Verification

#### Integration Tests
1. **Web App:**
   - Test signup → verify email → login flow
   - Test session persistence across requests
   - Test API proxy with JWT injection
   - Test token refresh on expiration

2. **API:**
   - Test JWT verification with valid WorkOS token
   - Test 401 on invalid/expired token
   - Test permission enforcement
   - Test organization ID validation

3. **End-to-End:**
   - Deploy to Cloudflare Workers preview
   - Verify full authentication flow works
   - Verify API calls succeed with proper JWT
   - Verify error handling works correctly

## Alternative Approaches Considered

### Alternative 1: Use Node.js Runtime Instead of Cloudflare Workers
**Pros:**
- `process.env` works natively
- WorkOS SDK fully compatible
- Less refactoring needed

**Cons:**
- Abandons Cloudflare Workers deployment strategy
- Loses edge network benefits
- Requires infrastructure changes
- Contradicts architectural decision in spec

**Decision:** Rejected - Fix the code to work with Workers as originally intended

### Alternative 2: Use Environment Variable Polyfill
**Pros:**
- Minimal code changes
- Maintains API compatibility

**Cons:**
- Adds unnecessary dependency
- Doesn't follow Cloudflare Workers best practices
- Hides platform-specific requirements

**Decision:** Rejected - Use proper Cloudflare Workers patterns

## Dependencies

- **Blocks:** All authentication features
- **Blocked By:** None
- **Related:** None

## Success Criteria

- [ ] All 8 web authentication functions accept `env` parameter
- [ ] All route handlers pass `context.cloudflare.env` to auth functions
- [ ] `@react-router/cloudflare` dependency installed
- [ ] KV namespace configured in `wrangler.toml`
- [ ] `WORKOS_CLIENT_ID` set to valid value
- [ ] JWKS URL fixed in API auth module
- [ ] Config validation added for `WORKOS_CLIENT_ID`
- [ ] Error response titles corrected
- [ ] Integration tests pass for full auth flow
- [ ] Web app deploys successfully to Cloudflare Workers
- [ ] API starts successfully with config validation

## Timeline

- **Estimated Effort:** 2-3 hours
- **Dependencies:** KV namespace creation (5 minutes manual setup)
- **Testing:** 1 hour integration + E2E testing

## Technical Design

Detailed technical design with layer-by-layer modifications is available in:

📄 **[design.md](./design.md)**

The design document includes:
- Current state baseline for each affected component
- Proposed modifications with before/after code examples
- Breaking changes analysis
- Migration strategy with dependency-driven order
- Comprehensive testing strategy
- Rollback procedures

### Summary of Changes

**Web Application (4 components):**
- Session Management: Add `env` parameter to `createSessionStorage()` and `getUserSession()`
- Auth Functions: Add `env` parameter to all 8 WorkOS SDK functions
- Route Handlers: Pass `context.cloudflare.env` to auth/session functions
- Configuration: Set KV namespace IDs and WorkOS Client ID

**API (3 components):**
- Auth Module: Fix JWKS URL (remove client ID from path)
- Config Module: Add validation for required `WORKOS_CLIENT_ID`
- Error Responses: Correct HTTP titles for 401/403 errors

**Affected Layers:**
- Web: Infrastructure (dependencies), Configuration, Auth Layer, Route Layer
- API: Configuration, Auth Layer, Error Handling

## Open Questions

1. What should be the production KV namespace ID?
2. Do we need to update the testing strategy to include Cloudflare Workers integration tests?
3. Should we add CI check to prevent `process.env` usage in Workers code?

## Approvals

- [ ] Technical Lead
- [ ] Product Owner (if applicable)
- [ ] Security Review (if applicable)
