# Web Coding Standards

## Code Style & Formatting

### Tooling
- **Primary:** Biome for fast formatting and linting
- **Type-Aware:** ESLint for React-specific rules
- **Indentation:** 2 spaces (React convention)
- **Quotes:** Double quotes for JSX attributes, prefer double quotes for strings
- **Semicolons:** Required (enforced by Biome)

### Commands
```bash
bun run format    # Format code with Biome
bun run lint      # Lint with Biome + ESLint
bun run types     # Type check with TypeScript
```

## React 19 Conventions

### Use Hook

```typescript
// React 19's `use` hook for promises and context
import { use } from "react"

function UserProfile({ userPromise }: { userPromise: Promise<User> }) {
  const user = use(userPromise) // Suspends until resolved
  return <div>{user.name}</div>
}

// Use with context
function ThemeButton() {
  const theme = use(ThemeContext)
  return <button className={theme}>Click</button>
}
```

### Server Components (if using)

```typescript
// Server Component (async components)
export default async function Dashboard() {
  const data = await fetchDashboardData()
  return <div>{data.title}</div>
}

// Client Component (use "use client" directive)
"use client"

import { useState } from "react"

export function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

### Component Patterns

```typescript
// Functional components with TypeScript
interface UserCardProps {
  user: User
  onSelect?: (user: User) => void
}

export function UserCard({ user, onSelect }: UserCardProps) {
  return (
    <div onClick={() => onSelect?.(user)}>
      <h3>{user.name}</h3>
    </div>
  )
}

// Use named exports
export { UserCard }

// Prefer function declarations for components
export function MyComponent() {
  return <div>Content</div>
}

// Avoid default exports (except for routes)
```

## Tailwind CSS v4 Patterns

### Utility-First Approach

```typescript
// ✅ Good: Use Tailwind utilities
function Card() {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold">Title</h3>
      <p className="mt-2 text-sm text-muted-foreground">Description</p>
    </div>
  )
}

// ❌ Avoid: Custom CSS unless absolutely necessary
// Don't create separate CSS files for styling
```

### Responsive Design

```typescript
function ResponsiveGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(item => <Card key={item.id} />)}
    </div>
  )
}
```

### Dynamic Classes

```typescript
import { cn } from "@/lib/utils" // clsx + tailwind-merge

function Button({ variant = "default", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "rounded-md px-4 py-2 font-medium",
        variant === "default" && "bg-primary text-primary-foreground",
        variant === "outline" && "border border-input bg-background",
        className
      )}
      {...props}
    />
  )
}
```

### Theme Variables

```typescript
// Use CSS variables from Tailwind theme
function ThemedCard() {
  return (
    <div className="bg-background text-foreground">
      <h3 className="text-primary">Title</h3>
      <p className="text-muted-foreground">Description</p>
    </div>
  )
}
```

## shadcn/ui Patterns

### Component Usage

```typescript
// Import and use shadcn/ui components
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function LoginForm() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Login</CardTitle>
        <CardDescription>Enter your credentials</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" />
          </div>
          <Button type="submit">Login</Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

### Customizing Components

```typescript
// Extend shadcn/ui components
import { Button } from "@/components/ui/button"

export function IconButton({ icon: Icon, ...props }: IconButtonProps) {
  return (
    <Button variant="ghost" size="icon" {...props}>
      <Icon className="h-4 w-4" />
    </Button>
  )
}
```

## Testing Standards

### Vitest + Testing Library

```typescript
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect } from "vitest"
import { LoginForm } from "./LoginForm"

describe("LoginForm", () => {
  it("submits form with user credentials", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    
    render(<LoginForm onSubmit={onSubmit} />)
    
    await user.type(screen.getByLabelText(/email/i), "user@example.com")
    await user.type(screen.getByLabelText(/password/i), "password123")
    await user.click(screen.getByRole("button", { name: /login/i }))
    
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "password123"
      })
    })
  })
})
```

### Testing with React Query

```typescript
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { useLedgers } from "./useLedgers"

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe("useLedgers", () => {
  it("fetches ledgers successfully", async () => {
    const { result } = renderHook(() => useLedgers(), {
      wrapper: createWrapper()
    })
    
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(2)
  })
})
```

### MSW for API Mocking

```typescript
// app/mocks/handlers.ts
import { http, HttpResponse } from "msw"

export const handlers = [
  http.get("/api/ledgers", () => {
    return HttpResponse.json({
      ledgers: [
        { id: "1", name: "Ledger 1" },
        { id: "2", name: "Ledger 2" }
      ]
    })
  }),
  
  http.post("/api/ledgers", async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json(
      { id: "3", ...body },
      { status: 201 }
    )
  })
]

// Setup server for tests
// app/mocks/server.ts
import { setupServer } from "msw/node"
import { handlers } from "./handlers"

export const server = setupServer(...handlers)

// test.setup.ts
import { beforeAll, afterEach, afterAll } from "vitest"
import { server } from "./app/mocks/server"

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

## File Naming & Organization

### File Names

```
// Routes: Match URL structure
app/routes/home.tsx               # /
app/routes/ledgers._index.tsx     # /ledgers
app/routes/ledgers.$id.tsx        # /ledgers/:id

// Components: PascalCase
app/components/AccountCard.tsx
app/components/ui/button.tsx

// Hooks: camelCase with 'use' prefix
app/hooks/useLedgers.ts
app/hooks/useAuth.ts

// Utilities: camelCase
app/lib/utils.ts
app/lib/format-currency.ts

// Stores: camelCase with 'use' prefix
app/stores/useUIStore.ts
app/stores/useCartStore.ts
```

### Directory Structure

```
app/
├── routes/              # React Router routes
│   ├── home.tsx
│   └── ledgers/
│       ├── _index.tsx
│       └── $id.tsx
├── components/
│   ├── ui/             # shadcn/ui components
│   ├── features/       # Feature-specific components
│   └── layout/         # Layout components
├── hooks/              # Custom React hooks
├── stores/             # Zustand stores
├── api/                # API client (openapi-react-query)
├── lib/                # Utilities
├── mocks/              # MSW handlers
├── app.css             # Global styles
├── root.tsx            # Root layout
└── routes.ts           # Route configuration
```

## TypeScript Patterns

### Component Props

```typescript
// Define props interfaces
interface AccountCardProps {
  account: Account
  variant?: "default" | "compact"
  onSelect?: (account: Account) => void
  className?: string
}

// Use PropsWithChildren for components with children
import type { PropsWithChildren } from "react"

type CardProps = PropsWithChildren<{
  title: string
  className?: string
}>

// React Router types
import type { Route } from "./+types/home"

export function loader({ params }: Route.LoaderArgs) {
  // Type-safe params
}

export default function Home({ loaderData }: Route.ComponentProps) {
  // Type-safe loader data
}
```

### Event Handlers

```typescript
// Type event handlers correctly
function Form() {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // Handle submit
  }
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log(e.target.value)
  }
  
  return (
    <form onSubmit={handleSubmit}>
      <input onChange={handleChange} />
    </form>
  )
}
```

### Generics

```typescript
// Generic components
interface ListProps<T> {
  items: T[]
  renderItem: (item: T) => React.ReactNode
  keyExtractor: (item: T) => string
}

function List<T>({ items, renderItem, keyExtractor }: ListProps<T>) {
  return (
    <div>
      {items.map(item => (
        <div key={keyExtractor(item)}>
          {renderItem(item)}
        </div>
      ))}
    </div>
  )
}

// Usage
<List
  items={accounts}
  renderItem={(account) => <AccountCard account={account} />}
  keyExtractor={(account) => account.id}
/>
```

## Form Handling

### React Router Forms

```typescript
import { Form } from "react-router"

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const name = formData.get("name") as string
  
  await createLedger({ name })
  
  return redirect("/ledgers")
}

export default function CreateLedger() {
  return (
    <Form method="post">
      <Input name="name" required />
      <Button type="submit">Create</Button>
    </Form>
  )
}
```

### Form Validation

```typescript
import { z } from "zod"

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters")
})

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const data = Object.fromEntries(formData)
  
  const result = schema.safeParse(data)
  
  if (!result.success) {
    return { errors: result.error.flatten() }
  }
  
  await createUser(result.data)
  return redirect("/dashboard")
}
```

## Performance Best Practices

### Lazy Loading

```typescript
import { lazy, Suspense } from "react"

const HeavyComponent = lazy(() => import("./HeavyComponent"))

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <HeavyComponent />
    </Suspense>
  )
}
```

### Memoization

```typescript
import { memo, useMemo, useCallback } from "react"

// Memo components that render often with same props
export const AccountCard = memo(function AccountCard({ account }: AccountCardProps) {
  return <div>{account.name}</div>
})

// Memoize expensive calculations
function Dashboard({ transactions }: { transactions: Transaction[] }) {
  const total = useMemo(() => {
    return transactions.reduce((sum, t) => sum + t.amount, 0)
  }, [transactions])
  
  return <div>Total: {total}</div>
}

// Memoize callbacks passed to children
function Parent() {
  const handleClick = useCallback(() => {
    console.log("clicked")
  }, [])
  
  return <Child onClick={handleClick} />
}
```

## Accessibility

### Semantic HTML

```typescript
// ✅ Good
function Article() {
  return (
    <article>
      <header>
        <h1>Title</h1>
      </header>
      <main>
        <p>Content</p>
      </main>
    </article>
  )
}
```

### ARIA Attributes

```typescript
function IconButton() {
  return (
    <button aria-label="Close" aria-pressed={isPressed}>
      <X className="h-4 w-4" />
    </button>
  )
}

function LoadingSpinner() {
  return <div role="status" aria-live="polite">Loading...</div>
}
```

### Focus Management

```typescript
import { useRef, useEffect } from "react"

function Modal({ isOpen }: { isOpen: boolean }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  
  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus()
    }
  }, [isOpen])
  
  return (
    <dialog open={isOpen}>
      <button ref={closeButtonRef}>Close</button>
    </dialog>
  )
}
```

## Error Handling

### Error Boundaries

```typescript
import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
  fallback?: (error: Error) => ReactNode
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null }
  
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  
  render() {
    if (this.state.error) {
      return this.props.fallback?.(this.state.error) || (
        <div>Something went wrong</div>
      )
    }
    
    return this.props.children
  }
}
```

### React Query Error Handling

```typescript
function AccountList() {
  const { data, error, isError } = useLedgerAccountsQuery({
    params: { ledgerId: "123" }
  })
  
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }
  
  return <div>{/* render data */}</div>
}
```

## Security

### XSS Prevention

```typescript
// React automatically escapes
function UserContent({ content }: { content: string }) {
  return <div>{content}</div> // Safe
}

// Avoid dangerouslySetInnerHTML
// If absolutely necessary, sanitize first
import DOMPurify from "dompurify"

function UnsafeHTML({ html }: { html: string }) {
  const clean = DOMPurify.sanitize(html)
  return <div dangerouslySetInnerHTML={{ __html: clean }} />
}
```

### Input Validation

```typescript
import { z } from "zod"

const emailSchema = z.string().email()

function validateEmail(email: string): boolean {
  return emailSchema.safeParse(email).success
}
```

## Documentation

### Component Documentation

```typescript
/**
 * AccountCard displays account information with optional actions.
 * 
 * @param account - Account data to display
 * @param variant - Visual variant of the card
 * @param onSelect - Callback when card is selected
 */
interface AccountCardProps {
  account: Account
  variant?: "default" | "compact"
  onSelect?: (account: Account) => void
}

export function AccountCard({ account, variant = "default", onSelect }: AccountCardProps) {
  // Implementation
}
```

### Hook Documentation

```typescript
/**
 * Custom hook to manage ledger accounts with caching and mutations.
 * 
 * @param ledgerId - ID of the ledger to fetch accounts for
 * @returns Object containing accounts data, loading state, and mutation functions
 * 
 * @example
 * ```tsx
 * const { accounts, isLoading, createAccount } = useLedgerAccounts("ledger-123")
 * ```
 */
export function useLedgerAccounts(ledgerId: string) {
  // Implementation
}
```

## Code Quality

### Pre-commit Checklist

```bash
# Before committing
bun run format    # Format code
bun run lint      # Check for errors
bun run types     # Type check
bun run test      # Run tests
```

### Code Review Guidelines

- Components are small and focused
- TypeScript types are explicit
- Tests cover user interactions
- Accessibility attributes are present
- Error and loading states are handled
- Performance optimizations are appropriate
- Security best practices are followed
