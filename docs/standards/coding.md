# Coding Standards

## TypeScript Conventions

All applications in this monorepo use TypeScript with strict type checking enabled.

### Type Definitions

```typescript
// Use explicit types for public APIs and interfaces
export interface CreateUserRequest {
  name: string
  email: string
  role?: UserRole
}

// Use type inference for internal variables
const user = await userRepo.create(request) // Type inferred from repository

// Use const assertions for literal types
const USER_ROLES = ["admin", "user", "guest"] as const
type UserRole = typeof USER_ROLES[number]

// Prefer type over interface for unions and intersections
type ID = string | number
type UserWithMetadata = User & { metadata: Record<string, unknown> }

// Use interface for object shapes that may be extended
interface Entity {
  id: string
  createdAt: Date
  updatedAt: Date
}

interface User extends Entity {
  name: string
  email: string
}
```

### Naming Conventions

```typescript
// PascalCase for types, interfaces, classes, enums
interface UserAccount { }
class UserService { }
type ResponseStatus = string
enum TransactionStatus { }

// camelCase for variables, functions, methods, parameters
const userAccount = await fetchAccount()
function calculateTotal(items: Item[]): number { }
const handleSubmit = () => { }

// SCREAMING_SNAKE_CASE for constants
const MAX_RETRY_ATTEMPTS = 3
const DEFAULT_PAGE_SIZE = 20
const API_BASE_URL = "https://api.example.com"

// kebab-case for file names (unless using PascalCase for components/classes)
user-service.ts
api-client.ts
UserProfile.tsx  // Component files can use PascalCase
```

### Import/Export Patterns

```typescript
// Group imports: external → internal → relative
import { FastifyInstance } from "fastify"
import { useQuery } from "@tanstack/react-query"

import { config } from "@/config"
import { UserService } from "@/services/UserService"

import { validateInput } from "./validation"
import type { User } from "./types"

// Prefer named exports over default exports
export { UserService }
export type { User, CreateUserRequest }

// Use type-only imports when importing only types
import type { FC } from "react"
import type { User } from "./types"
```

## Code Organization

### File Structure

```typescript
// One primary export per file (class, function, component)
// File name should match primary export

// UserService.ts
export class UserService {
  // Implementation
}

// useUser.ts
export function useUser(id: string) {
  // Implementation
}

// UserProfile.tsx
export function UserProfile() {
  // Implementation
}
```

### Directory Organization

Organize by feature/domain, not by technical layer:

```
✅ Good (Feature-based):
src/
├── users/
│   ├── UserService.ts
│   ├── UserRepository.ts
│   ├── UserEntity.ts
│   └── types.ts
├── transactions/
│   ├── TransactionService.ts
│   ├── TransactionRepository.ts
│   └── types.ts

❌ Avoid (Layer-based for large projects):
src/
├── services/
│   ├── UserService.ts
│   └── TransactionService.ts
├── repositories/
│   ├── UserRepository.ts
│   └── TransactionRepository.ts
```

Note: Layer-based organization is acceptable for smaller projects or when mandated by framework conventions.

## Error Handling

### Error Types

```typescript
// Define custom error classes for domain errors
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly fields: Record<string, string[]>
  ) {
    super(message)
    this.name = "ValidationError"
  }
}

export class NotFoundError extends Error {
  constructor(
    public readonly resource: string,
    public readonly id: string
  ) {
    super(`${resource} with id ${id} not found`)
    this.name = "NotFoundError"
  }
}

// Use error types for control flow
try {
  const user = await userService.getUser(id)
} catch (error) {
  if (error instanceof NotFoundError) {
    return { status: 404, message: error.message }
  }
  if (error instanceof ValidationError) {
    return { status: 422, errors: error.fields }
  }
  throw error // Re-throw unexpected errors
}
```

### Error Handling Patterns

```typescript
// Always handle errors at appropriate layer
async function createUser(request: CreateUserRequest): Promise<User> {
  try {
    // Attempt operation
    return await userRepository.create(request)
  } catch (error) {
    // Log error with context
    logger.error("Failed to create user", { error, request })
    
    // Transform infrastructure errors to domain errors
    if (error.code === "23505") { // Unique constraint violation
      throw new ValidationError("User already exists", {
        email: ["Email is already taken"]
      })
    }
    
    // Re-throw unexpected errors
    throw error
  }
}
```

## Testing Standards

### Test-Driven Development (TDD)

Follow the Red-Green-Refactor cycle:

1. **Red**: Write a failing test that defines desired behavior
2. **Green**: Write minimal code to make the test pass
3. **Refactor**: Improve code quality while maintaining passing tests

### Test Structure

```typescript
// Use describe blocks to organize tests by feature/method
describe("UserService", () => {
  describe("createUser", () => {
    it("should create user with valid data", async () => {
      // Arrange: Set up test data and dependencies
      const request = { name: "John", email: "john@example.com" }
      const mockRepo = createMockRepository()
      const service = new UserService(mockRepo)

      // Act: Execute the operation
      const result = await service.createUser(request)

      // Assert: Verify the outcome
      expect(result).toMatchObject({
        name: "John",
        email: "john@example.com"
      })
      expect(mockRepo.create).toHaveBeenCalledWith(request)
    })

    it("should reject invalid email format", async () => {
      const request = { name: "John", email: "invalid-email" }
      const service = new UserService(mockRepo)

      await expect(service.createUser(request))
        .rejects.toThrow(ValidationError)
    })
  })
})
```

### Testing Patterns

```typescript
// Unit Tests: Test in isolation with mocked dependencies
describe("UserService (unit)", () => {
  let service: UserService
  let mockRepo: jest.Mocked<UserRepository>

  beforeEach(() => {
    mockRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn()
    }
    service = new UserService(mockRepo)
  })

  it("should call repository with correct data", async () => {
    const request = { name: "John", email: "john@example.com" }
    await service.createUser(request)
    
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining(request)
    )
  })
})

// Integration Tests: Test with real dependencies
describe("UserService (integration)", () => {
  let service: UserService
  let database: Database

  beforeEach(async () => {
    database = await setupTestDatabase()
    const repo = new UserRepository(database)
    service = new UserService(repo)
  })

  afterEach(async () => {
    await database.cleanup()
  })

  it("should persist user to database", async () => {
    const request = { name: "John", email: "john@example.com" }
    const user = await service.createUser(request)
    
    const found = await database.query("SELECT * FROM users WHERE id = ?", [user.id])
    expect(found).toMatchObject(request)
  })
})
```

### Test File Conventions

```typescript
// Test files use .test.ts or .spec.ts suffix
UserService.test.ts
UserService.spec.ts

// Test files located alongside source files
src/services/UserService.ts
src/services/UserService.test.ts

// Or in separate __tests__ directory
src/services/UserService.ts
src/services/__tests__/UserService.test.ts
```

## Code Quality

### Linting and Formatting

- Use consistent formatting tools across all apps (Biome, Prettier, ESLint)
- Configure pre-commit hooks to enforce formatting
- Enable auto-fix on save in your editor
- Run linting before commits and in CI/CD

### Code Reviews

When reviewing code, check for:

- **Architecture**: Does code respect layer boundaries?
- **Testing**: Are new features covered by tests?
- **Error Handling**: Are errors handled appropriately?
- **Performance**: Are there obvious performance issues?
- **Security**: Are inputs validated? Are there security risks?
- **Documentation**: Are complex parts explained?

### Complexity Management

```typescript
// Avoid deeply nested code
❌ Avoid:
if (user) {
  if (user.isActive) {
    if (user.hasPermission("write")) {
      if (resource.isAvailable) {
        // Do something
      }
    }
  }
}

✅ Prefer early returns:
if (!user) return
if (!user.isActive) return
if (!user.hasPermission("write")) return
if (!resource.isAvailable) return

// Do something
```

```typescript
// Extract complex logic to named functions
❌ Avoid:
const result = items
  .filter(item => item.price > 100 && item.category === "electronics" && !item.isDiscounted)
  .map(item => ({ ...item, finalPrice: item.price * 0.9 }))
  .reduce((sum, item) => sum + item.finalPrice, 0)

✅ Prefer:
const isPremiumElectronics = (item: Item) => 
  item.price > 100 && item.category === "electronics" && !item.isDiscounted

const applyDiscount = (item: Item) => ({
  ...item,
  finalPrice: item.price * 0.9
})

const sumPrices = (items: Item[]) =>
  items.reduce((sum, item) => sum + item.finalPrice, 0)

const result = sumPrices(
  items.filter(isPremiumElectronics).map(applyDiscount)
)
```

## Documentation

### Code Comments

```typescript
// Use JSDoc for public APIs
/**
 * Creates a new user account with the provided information.
 * 
 * @param request - User creation request containing name and email
 * @returns Created user with generated ID and timestamps
 * @throws ValidationError when email format is invalid or email already exists
 * @throws DatabaseError when database operation fails
 */
export async function createUser(request: CreateUserRequest): Promise<User>

// Use inline comments to explain "why", not "what"
❌ Avoid:
// Loop through items
for (const item of items) {
  // Add item to cart
  cart.add(item)
}

✅ Prefer:
// Pre-populate cart with recommended items to improve conversion rate
for (const item of recommendedItems) {
  cart.add(item)
}
```

### README Documentation

Each application/package should include:

- **Quick start**: How to run the app locally
- **Architecture overview**: High-level structure and patterns
- **Development workflow**: Commands, testing, common tasks
- **Deployment**: How to build and deploy

## Performance

### General Guidelines

- **Measure before optimizing**: Use profiling tools to identify bottlenecks
- **Avoid premature optimization**: Write clear code first, optimize later
- **Cache wisely**: Cache expensive operations, invalidate correctly
- **Batch operations**: Group similar operations when possible

### Common Patterns

```typescript
// Avoid N+1 queries
❌ Avoid:
const users = await getUsers()
for (const user of users) {
  user.posts = await getPostsByUserId(user.id) // N queries
}

✅ Prefer:
const users = await getUsers()
const userIds = users.map(u => u.id)
const posts = await getPostsByUserIds(userIds) // 1 query
const postsByUserId = groupBy(posts, 'userId')
users.forEach(user => {
  user.posts = postsByUserId[user.id] || []
})
```

## Security

### Input Validation

- Validate all user input at entry points
- Use schema validation libraries (Zod, TypeBox, Yup)
- Sanitize data before using in queries or rendering
- Never trust client-side validation alone

### Authentication & Authorization

- Verify authentication on every request
- Check authorization before accessing resources
- Use secure token storage and transmission
- Implement proper session management

### Data Protection

- Hash passwords with strong algorithms (bcrypt, argon2)
- Encrypt sensitive data at rest and in transit
- Use environment variables for secrets
- Never commit secrets to version control

## App-Specific Standards

Each application may extend these principles with technology-specific conventions:

- **API App**: See `apps/api/docs/standards/coding.md` for Fastify, Drizzle, PostgreSQL conventions
- **Web App**: See `apps/web/docs/standards/coding.md` for React, Tailwind, Vitest conventions
- **Docs App**: See `apps/docs/docs/standards/coding.md` for Docusaurus content conventions
