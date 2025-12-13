# Web App Agent Development Guide

## Product Documentation

- **Product Overview**: See `/docs/product/product.md` for overall platform vision
- **Roadmap**: See `/docs/product/roadmap.md` for feature priorities
- **Architecture Standards**: See `/docs/standards/architecture.md` for layered architecture principles
- **Coding Standards**: See `/docs/standards/coding.md` for TypeScript and TDD patterns
- **Web-Specific Standards**: See `apps/web/docs/standards/` for React/Tailwind patterns

## Tech Stack

- **Framework:** React Router v7
- **UI Library:** React 19
- **Styling:** Tailwind CSS v4, shadcn/ui components
- **Data Fetching:** openapi-react-query (type-safe API client), TanStack React Query
- **State Management:** Zustand for client state, React Query for server state
- **Testing:** Vitest, Testing Library, MSW (Mock Service Worker)
- **Build Tool:** Vite
- **Code Quality:** Biome + ESLint

## Commands

### **Development**
```bash
# From monorepo root
bun run dev:web          # Start web app only
bun run dev              # Start all apps (including API)

# From apps/web directory
bun run dev              # Start development server
```

### **Testing**
```bash
# From monorepo root
bun --filter=@exchequerio/web test

# From apps/web directory
bun run test             # Run all tests
bun run test:watch       # Run tests in watch mode
```

### **Code Quality**
```bash
# From monorepo root
bun run check            # Run all quality checks across apps

# From apps/web directory
bun run format           # Format code with Biome
bun run lint             # Lint with Biome + ESLint
bun run types            # Type check with TypeScript
```

### **Build**
```bash
# From monorepo root
bun --filter=@exchequerio/web build

# From apps/web directory
bun run build            # Build for production
bun run start            # Start production server
```

## Architecture Pattern

The web app follows a layered architecture:

```
Routes/Pages → Components → Hooks/State → API Client → Services
```

### Layer Responsibilities

#### **Routes/Pages** (`app/routes/`)
- Route definitions and page-level components
- Data loading via React Router loaders
- Form handling via React Router actions
- Page-level layouts and error boundaries

#### **Components** (`app/components/`)
- Reusable UI components
- shadcn/ui component customizations
- Component composition and patterns
- UI state management (local component state)

#### **Hooks/State** (`app/hooks/`, `app/stores/`)
- Custom React hooks for shared logic
- Zustand stores for client state (e.g., UI preferences, local data)
- React Query hooks for server state (API data)
- Form validation and submission logic

#### **API Client** (`app/api/` or `app/lib/`)
- openapi-react-query generated client
- Type-safe API calls using React Query
- Request/response type definitions
- API error handling

## Development Patterns

### React Router v7 Patterns

```typescript
// Route with loader
import type { Route } from "./+types/home"

export async function loader({ params }: Route.LoaderArgs) {
  const data = await fetchData(params.id)
  return { data }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return <div>{loaderData.data}</div>
}
```

### React Query with openapi-react-query

```typescript
// Auto-generated type-safe API hooks
import { useLedgerAccountsQuery } from "@/api/queries"

function AccountList() {
  const { data, isLoading, error } = useLedgerAccountsQuery({
    params: { ledgerId: "123" }
  })

  if (isLoading) return <Loading />
  if (error) return <Error error={error} />
  
  return <div>{/* render accounts */}</div>
}
```

### Zustand for Client State

```typescript
// app/stores/useUIStore.ts
import { create } from "zustand"

interface UIStore {
  sidebarOpen: boolean
  toggleSidebar: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen }))
}))

// Usage in components
function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useUIStore()
  return <aside className={sidebarOpen ? "open" : "closed"}>...</aside>
}
```

### shadcn/ui Components

```typescript
// Import pre-built components
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

function MyComponent() {
  return (
    <Card>
      <CardHeader>Title</CardHeader>
      <CardContent>
        <Button variant="default">Click me</Button>
      </CardContent>
    </Card>
  )
}
```

### Tailwind CSS v4 Patterns

```typescript
// Use Tailwind utility classes
function Header() {
  return (
    <header className="bg-background border-b">
      <div className="container mx-auto px-4 py-3">
        <h1 className="text-2xl font-bold text-foreground">Exchequer</h1>
      </div>
    </header>
  )
}

// Responsive design
function Grid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {/* Items */}
    </div>
  )
}
```

## Testing Patterns

### Component Testing with Vitest + Testing Library

```typescript
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { AccountList } from "./AccountList"

describe("AccountList", () => {
  it("renders account list", () => {
    render(<AccountList accounts={mockAccounts} />)
    expect(screen.getByText("Account 1")).toBeInTheDocument()
  })
})
```

### API Mocking with MSW

```typescript
// app/mocks/handlers.ts
import { http, HttpResponse } from "msw"

export const handlers = [
  http.get("/api/ledgers/:id/accounts", () => {
    return HttpResponse.json({
      accounts: [
        { id: "1", name: "Account 1" },
        { id: "2", name: "Account 2" }
      ]
    })
  })
]

// Use in tests
import { server } from "@/mocks/server"

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
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

## Environment Setup

### Prerequisites

- Node.js 18+ (via mise)
- Bun 1.2+
- API running on `http://localhost:3000` (for development)

### Configuration

```bash
# .env (if needed)
VITE_API_URL=http://localhost:3000
```

## Common Tasks

### Adding a New Page

```bash
# Create route file
touch app/routes/my-page.tsx

# Add route definition
export default function MyPage() {
  return <div>My Page</div>
}
```

### Adding a shadcn/ui Component

```bash
# Use shadcn CLI
bunx shadcn@latest add button

# Component added to app/components/ui/button.tsx
```

### Creating a Zustand Store

```bash
# Create store file
touch app/stores/useMyStore.ts

# Define store with TypeScript
import { create } from "zustand"

interface MyStore {
  count: number
  increment: () => void
}

export const useMyStore = create<MyStore>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 }))
}))
```

## Best Practices

### Performance
- Use React Query for server state (automatic caching, refetching)
- Use Zustand for client state (minimal re-renders)
- Lazy load routes with React Router
- Optimize images and assets

### Accessibility
- Use semantic HTML
- Add ARIA labels where needed
- Test keyboard navigation
- Ensure color contrast meets WCAG standards

### Type Safety
- Use openapi-react-query for type-safe API calls
- Define TypeScript interfaces for all props
- Avoid `any` types
- Use strict mode in tsconfig.json

### Testing
- Test user interactions, not implementation details
- Mock API calls with MSW
- Test loading and error states
- Maintain high test coverage for critical paths

## Troubleshooting

### Common Issues

**Issue:** "Module not found" errors
- **Solution:** Check import paths use `@/` alias or relative paths correctly

**Issue:** API calls failing in development
- **Solution:** Ensure API server is running on `http://localhost:3000`

**Issue:** Tailwind styles not applying
- **Solution:** Check `tailwind.config.ts` includes correct content paths

**Issue:** Type errors from openapi-react-query
- **Solution:** Regenerate client with latest API schema

## Documentation

See `apps/web/docs/standards/` for detailed:
- **architecture.md** - Component patterns, state management, routing
- **coding.md** - React 19 conventions, Tailwind patterns, testing strategies
