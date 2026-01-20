# Web Architecture Standards

## Technology Stack

### Core Stack
- **Framework:** React Router v7 with file-based routing
- **UI Library:** React 19 with latest features (use hook, Server Components)
- **Styling:** Tailwind CSS v4 with shadcn/ui component library
- **Data Fetching:** openapi-react-query for type-safe API client, TanStack React Query for server state
- **State Management:** Zustand for client state, React Query for server state
- **Build Tool:** Vite for fast development and optimized builds
- **Testing:** Vitest, React Testing Library, MSW (Mock Service Worker)

### Supporting Technologies
- **Type Safety:** TypeScript with strict mode
- **Code Quality:** Biome + ESLint
- **Form Handling:** React Router forms + actions
- **Icons:** lucide-react
- **Utilities:** clsx, tailwind-merge

## Layered Architecture Pattern

### Architecture Flow
```
Routes/Pages → Components → Hooks/State → API Client → Backend API
```

### Layer Responsibilities

#### **Routes/Pages Layer** (`app/routes/`)
- Route definitions using React Router v7 file-based routing
- Data loading via loaders (server-side data fetching)
- Form submissions via actions (server-side mutations)
- Page-level layouts and error boundaries
- SEO metadata (title, description, og tags)

**Standards:**
- Use loaders for server-side data fetching
- Use actions for form submissions and mutations
- Handle loading and error states appropriately
- Define route types using `Route.LoaderArgs`, `Route.ComponentProps`

```typescript
// app/routes/ledgers.$id.tsx
import type { Route } from "./+types/ledgers.$id"

export async function loader({ params }: Route.LoaderArgs) {
  const ledger = await fetchLedger(params.id)
  return { ledger }
}

export default function LedgerDetail({ loaderData }: Route.ComponentProps) {
  const { ledger } = loaderData
  return <div>{ledger.name}</div>
}
```

#### **Component Layer** (`app/components/`)
- Reusable UI components
- Feature-specific components
- shadcn/ui component customizations
- Presentation logic only (no business logic)

**Organization:**
- `components/ui/` - shadcn/ui components (button, card, dialog, etc.)
- `components/features/` - Feature-specific components (AccountCard, TransactionList)
- `components/layout/` - Layout components (Header, Sidebar, Footer)

**Standards:**
- Components receive data via props
- No direct API calls in components (use hooks)
- Use TypeScript interfaces for props
- Compose small, focused components

```typescript
// app/components/features/AccountCard.tsx
interface AccountCardProps {
  account: Account
  onSelect?: (account: Account) => void
}

export function AccountCard({ account, onSelect }: AccountCardProps) {
  return (
    <Card onClick={() => onSelect?.(account)}>
      <CardHeader>
        <h3>{account.name}</h3>
      </CardHeader>
      <CardContent>
        <p>Balance: {formatCurrency(account.balance)}</p>
      </CardContent>
    </Card>
  )
}
```

#### **Hooks/State Layer** (`app/hooks/`, `app/stores/`)
- Custom React hooks for shared logic
- Zustand stores for client-side state
- React Query hooks for server state management
- Form validation and submission logic

**Client State (Zustand):**
- UI preferences (sidebar open/closed, theme)
- Local data (shopping cart, draft forms)
- Global UI state

**Server State (React Query):**
- API data caching
- Background refetching
- Optimistic updates
- Error handling

**Standards:**
- Use Zustand for client state
- Use React Query for server state
- Create custom hooks to abstract complexity
- Co-locate hooks with related components when possible

```typescript
// app/stores/useUIStore.ts
import { create } from "zustand"

interface UIStore {
  sidebarOpen: boolean
  toggleSidebar: () => void
  theme: "light" | "dark"
  setTheme: (theme: "light" | "dark") => void
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  theme: "light",
  setTheme: (theme) => set({ theme })
}))
```

#### **API Client Layer** (`app/api/` or `app/lib/api/`)
- openapi-react-query generated hooks
- Type-safe API calls
- Request/response transformations
- API error handling

**Standards:**
- Use openapi-react-query for type-safe API client
- Define API hooks using React Query conventions
- Handle errors consistently
- Transform API responses to UI-friendly formats

```typescript
// Auto-generated from OpenAPI spec
import { useLedgerAccountsQuery, useCreateLedgerMutation } from "@/api/queries"

// Usage in components
function AccountList({ ledgerId }: { ledgerId: string }) {
  const { data, isLoading, error } = useLedgerAccountsQuery({
    params: { ledgerId }
  })

  if (isLoading) return <Skeleton />
  if (error) return <ErrorMessage error={error} />
  
  return <div>{data.accounts.map(account => <AccountCard key={account.id} account={account} />)}</div>
}
```

## React Router v7 Patterns

### File-Based Routing

```
app/routes/
├── home.tsx                  # /
├── ledgers._index.tsx        # /ledgers
├── ledgers.$id.tsx           # /ledgers/:id
├── ledgers.$id.accounts.tsx  # /ledgers/:id/accounts
└── ledgers.$id._layout.tsx   # Layout for /ledgers/:id/*
```

### Loaders (Server-Side Data Fetching)

```typescript
// Fetch data on the server before rendering
export async function loader({ params, request }: Route.LoaderArgs) {
  const ledger = await fetchLedger(params.id)
  
  if (!ledger) {
    throw new Response("Not Found", { status: 404 })
  }
  
  return { ledger }
}

export default function LedgerDetail({ loaderData }: Route.ComponentProps) {
  return <div>{loaderData.ledger.name}</div>
}
```

### Actions (Server-Side Mutations)

```typescript
// Handle form submissions on the server
export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData()
  const name = formData.get("name")
  
  const ledger = await createLedger({ name, id: params.id })
  
  return redirect(`/ledgers/${ledger.id}`)
}

export default function CreateLedger() {
  return (
    <Form method="post">
      <input name="name" required />
      <button type="submit">Create</button>
    </Form>
  )
}
```

## State Management Strategy

### When to Use Zustand (Client State)

Use Zustand for:
- UI state that persists across route changes (sidebar, theme)
- User preferences
- Draft data before submission
- Global modal/dialog state

```typescript
// app/stores/useUIStore.ts
export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen }))
}))

// Usage
function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useUIStore()
  return (
    <aside className={cn("sidebar", sidebarOpen && "open")}>
      <button onClick={toggleSidebar}>Toggle</button>
    </aside>
  )
}
```

### When to Use React Query (Server State)

Use React Query for:
- API data fetching and caching
- Background data synchronization
- Optimistic updates
- Infinite scrolling / pagination

```typescript
// app/hooks/useLedgers.ts
import { useLedgersQuery, useCreateLedgerMutation } from "@/api/queries"

export function useLedgers() {
  const { data, isLoading, error } = useLedgersQuery()
  const createMutation = useCreateLedgerMutation()
  
  const createLedger = async (ledger: CreateLedgerRequest) => {
    return await createMutation.mutateAsync({ body: ledger })
  }
  
  return { ledgers: data?.ledgers, isLoading, error, createLedger }
}
```

### When to Use Local Component State

Use `useState` for:
- Form input values (if not using React Router forms)
- Toggle states (dropdowns, accordions)
- Temporary UI state
- Component-specific state

```typescript
function Accordion() {
  const [isOpen, setIsOpen] = useState(false)
  
  return (
    <div>
      <button onClick={() => setIsOpen(!isOpen)}>Toggle</button>
      {isOpen && <div>Content</div>}
    </div>
  )
}
```

## Component Patterns

### Composition Over Props Drilling

```typescript
// ✅ Good: Use context or composition
function Dashboard() {
  return (
    <DashboardProvider ledgerId="123">
      <DashboardHeader />
      <DashboardContent />
      <DashboardSidebar />
    </DashboardProvider>
  )
}

// ❌ Avoid: Props drilling through many levels
function Dashboard({ ledgerId }: { ledgerId: string }) {
  return <DashboardHeader ledgerId={ledgerId}>
    <DashboardContent ledgerId={ledgerId}>
      <DashboardSidebar ledgerId={ledgerId} />
    </DashboardContent>
  </DashboardHeader>
}
```

### Container/Presentation Pattern

```typescript
// Container: Data fetching and logic
function AccountListContainer() {
  const { data, isLoading } = useLedgerAccountsQuery({ params: { ledgerId: "123" } })
  
  if (isLoading) return <Skeleton />
  
  return <AccountList accounts={data.accounts} />
}

// Presentation: Pure rendering
interface AccountListProps {
  accounts: Account[]
}

function AccountList({ accounts }: AccountListProps) {
  return (
    <div className="grid gap-4">
      {accounts.map(account => <AccountCard key={account.id} account={account} />)}
    </div>
  )
}
```

### shadcn/ui Component Usage

```typescript
// Import pre-built components
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog"

function MyComponent() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Title</CardTitle>
      </CardHeader>
      <CardContent>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="default">Open</Button>
          </DialogTrigger>
          <DialogContent>
            <p>Dialog content</p>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
```

## Performance Optimization

### Code Splitting

```typescript
// Lazy load routes
import { lazy } from "react"

const LedgerDetail = lazy(() => import("./routes/ledgers.$id"))

// React Router handles code splitting automatically for routes
```

### Memoization

```typescript
import { useMemo, useCallback } from "react"

function ExpensiveComponent({ items }: { items: Item[] }) {
  // Memoize expensive calculations
  const total = useMemo(() => {
    return items.reduce((sum, item) => sum + item.price, 0)
  }, [items])
  
  // Memoize callbacks to prevent re-renders
  const handleClick = useCallback((item: Item) => {
    console.log(item)
  }, [])
  
  return <div>{total}</div>
}
```

### React Query Optimization

```typescript
// Prefetch data on hover
function AccountLink({ id }: { id: string }) {
  const queryClient = useQueryClient()
  
  const prefetch = () => {
    queryClient.prefetchQuery({
      queryKey: ["account", id],
      queryFn: () => fetchAccount(id)
    })
  }
  
  return (
    <Link to={`/accounts/${id}`} onMouseEnter={prefetch}>
      Account
    </Link>
  )
}

// Optimistic updates
function useUpdateAccount() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: updateAccount,
    onMutate: async (newAccount) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["account", newAccount.id] })
      
      // Snapshot previous value
      const previous = queryClient.getQueryData(["account", newAccount.id])
      
      // Optimistically update
      queryClient.setQueryData(["account", newAccount.id], newAccount)
      
      return { previous }
    },
    onError: (err, newAccount, context) => {
      // Rollback on error
      queryClient.setQueryData(["account", newAccount.id], context?.previous)
    }
  })
}
```

## Error Handling

### Error Boundaries

```typescript
// app/components/ErrorBoundary.tsx
import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

export class ErrorBoundary extends Component<Props, { hasError: boolean }> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }
  
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  
  render() {
    if (this.state.hasError) {
      return this.props.fallback || <div>Something went wrong</div>
    }
    
    return this.props.children
  }
}
```

### API Error Handling

```typescript
// Centralized error handling with React Query
import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors
        if (error.status >= 400 && error.status < 500) {
          return false
        }
        return failureCount < 3
      },
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
    mutations: {
      onError: (error) => {
        // Global error handling
        console.error("Mutation error:", error)
      }
    }
  }
})
```

## Testing Strategy

### Component Testing

```typescript
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { AccountCard } from "./AccountCard"

describe("AccountCard", () => {
  it("renders account information", () => {
    const account = { id: "1", name: "Test Account", balance: 1000 }
    
    render(<AccountCard account={account} />)
    
    expect(screen.getByText("Test Account")).toBeInTheDocument()
    expect(screen.getByText(/1000/)).toBeInTheDocument()
  })
})
```

### MSW for API Mocking

```typescript
// app/mocks/handlers.ts
import { http, HttpResponse } from "msw"

export const handlers = [
  http.get("/api/ledgers/:id/accounts", ({ params }) => {
    return HttpResponse.json({
      accounts: [
        { id: "1", name: "Account 1", balance: 1000 },
        { id: "2", name: "Account 2", balance: 2000 }
      ]
    })
  })
]

// app/mocks/server.ts
import { setupServer } from "msw/node"
import { handlers } from "./handlers"

export const server = setupServer(...handlers)

// test.setup.ts
import { beforeAll, afterEach, afterAll } from "vitest"
import { server } from "./mocks/server"

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

## Accessibility

### Semantic HTML

```typescript
// ✅ Good: Use semantic HTML
function Article() {
  return (
    <article>
      <header>
        <h1>Title</h1>
      </header>
      <section>
        <p>Content</p>
      </section>
    </article>
  )
}

// ❌ Avoid: Generic divs everywhere
function Article() {
  return (
    <div>
      <div>Title</div>
      <div>Content</div>
    </div>
  )
}
```

### ARIA Labels

```typescript
// Add ARIA labels for screen readers
function IconButton() {
  return (
    <button aria-label="Close dialog">
      <X className="h-4 w-4" />
    </button>
  )
}
```

### Keyboard Navigation

```typescript
// Ensure interactive elements are keyboard accessible
function Dropdown() {
  return (
    <div role="menu">
      <button role="menuitem" onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleAction()
        }
      }}>
        Action
      </button>
    </div>
  )
}
```

## Security

### XSS Prevention

```typescript
// ✅ Good: React escapes by default
function UserName({ name }: { name: string }) {
  return <div>{name}</div> // Automatically escaped
}

// ❌ Avoid: dangerouslySetInnerHTML unless absolutely necessary
function UnsafeHTML({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
```

### Authentication

```typescript
// Protect routes with authentication
export async function loader({ request }: Route.LoaderArgs) {
  const user = await getAuthUser(request)
  
  if (!user) {
    throw redirect("/login")
  }
  
  return { user }
}
```

## File Structure

```
app/
├── routes/              # React Router routes
│   ├── home.tsx
│   └── ledgers/
│       ├── $id.tsx
│       └── $id.accounts.tsx
├── components/
│   ├── ui/             # shadcn/ui components
│   │   ├── button.tsx
│   │   └── card.tsx
│   └── features/       # Feature-specific components
│       └── AccountCard.tsx
├── hooks/              # Custom React hooks
│   └── useAccount.ts
├── stores/             # Zustand stores
│   └── useUIStore.ts
├── api/                # API client (openapi-react-query)
│   ├── queries.ts
│   └── mutations.ts
├── lib/                # Utilities
│   └── utils.ts
├── app.css             # Global styles
├── root.tsx            # Root layout
└── routes.ts           # Route configuration
```

## Development Workflow

### Feature Development Process

1. **Create Route** - Add route file in `app/routes/`
2. **Define Types** - Add TypeScript interfaces
3. **Build Components** - Create UI components
4. **Add State** - Use Zustand for client state, React Query for server state
5. **Write Tests** - Add component and integration tests
6. **Style** - Apply Tailwind classes and shadcn/ui components
7. **Optimize** - Add performance optimizations if needed

### Best Practices

- Follow React Router v7 conventions (loaders, actions)
- Use TypeScript for all components and hooks
- Test user interactions, not implementation
- Keep components small and focused
- Use shadcn/ui for consistent UI
- Apply Tailwind for styling, avoid custom CSS
- Handle loading and error states explicitly
