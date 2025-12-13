# Architecture Standards

## Layered Architecture Pattern

All applications in this monorepo follow a layered architecture pattern with clear separation of concerns and unidirectional dependency flow.

### Architecture Principles

#### Separation of Concerns
- Each layer has a single, well-defined responsibility
- Layers communicate through defined interfaces
- Business logic is isolated from infrastructure concerns
- Data transformation happens at layer boundaries

#### Dependency Direction
- Dependencies flow inward toward the domain
- Outer layers depend on inner layers, never the reverse
- Infrastructure depends on domain, not vice versa
- UI/API layers are replaceable without changing business logic

#### Single Responsibility
- Each layer handles one aspect of the application
- Presentation layer: User interaction and data presentation
- Service/Business layer: Domain logic and rules
- Data layer: Data access and persistence
- Entity/Domain layer: Data models and transformations

### Common Layered Patterns

#### Backend API Pattern
```
Routes/Controllers → Services → Repositories → Entities → Database
```

**Layer Responsibilities:**
- **Routes/Controllers**: HTTP handling, validation, auth
- **Services**: Business logic, orchestration, domain rules
- **Repositories**: Data access abstraction, queries
- **Entities**: Domain models, transformations, validation
- **Database**: Persistence, schema, constraints

#### Frontend Pattern
```
Pages/Routes → Components → Hooks/State → API Client → Services
```

**Layer Responsibilities:**
- **Pages/Routes**: Route handling, page-level state
- **Components**: UI rendering, user interaction
- **Hooks/State**: Client state, server state (react-query), global state (zustand)
- **API Client**: Type-safe API communication
- **Services**: Business logic, data transformation

### Cross-Cutting Concerns

#### Authentication & Authorization
- Implemented at the outermost layer (Routes/Controllers, Pages)
- Authorization rules may invoke service layer for complex decisions
- Auth context propagated through layers as needed

#### Error Handling
- Domain errors defined in entity/service layer
- Infrastructure errors handled at repository/API client layer
- Presentation layer translates errors for user/API consumer
- Logging at appropriate layer boundaries

#### Validation
- Input validation at entry points (Routes, Forms)
- Business rule validation in service layer
- Data integrity validation at repository/database layer
- Entity validation for data transformations

#### Logging & Monitoring
- Request/response logging at API/Route layer
- Business event logging at service layer
- Database query logging at repository layer
- Performance monitoring at layer boundaries

## Design Patterns

### Dependency Injection
- Constructor injection preferred over property injection
- Interfaces define contracts between layers
- Promotes testability and loose coupling

### Repository Pattern
- Abstracts data access logic
- Provides consistent interface for data operations
- Enables testing without database dependencies

### Service Pattern
- Encapsulates business logic
- Coordinates between repositories and entities
- Handles transaction boundaries

### Entity/Domain Model Pattern
- Represents business concepts
- Encapsulates data transformation logic
- Validates business rules

## Architecture Boundaries

### What Each Layer Can Do

#### Presentation Layer (Routes, Pages, Components)
✅ **Can:**
- Handle HTTP requests/responses or UI events
- Validate input format and structure
- Call service layer methods
- Transform service responses for presentation
- Manage authentication/authorization
- Handle presentation-specific errors

❌ **Cannot:**
- Contain business logic
- Access repositories directly
- Access database directly
- Implement domain rules

#### Service/Business Layer
✅ **Can:**
- Implement business rules and domain logic
- Orchestrate multiple repository calls
- Manage transaction boundaries
- Transform data using entities
- Validate business constraints
- Emit business events/logs

❌ **Cannot:**
- Access HTTP request/response objects
- Access UI state directly
- Access database directly (must use repositories)
- Contain presentation logic

#### Repository/Data Access Layer
✅ **Can:**
- Execute database queries
- Map between database records and entities
- Handle database-specific errors
- Manage database connections
- Implement caching strategies

❌ **Cannot:**
- Implement business logic
- Validate business rules
- Access HTTP objects
- Transform data for presentation

#### Entity/Domain Layer
✅ **Can:**
- Define domain models and types
- Implement data transformations
- Validate data structure and format
- Encapsulate domain-specific logic

❌ **Cannot:**
- Access external dependencies (database, APIs)
- Contain presentation logic
- Contain infrastructure concerns

## Testing Strategy

### Unit Tests
- Test each layer in isolation
- Mock dependencies from lower layers
- Focus on business logic and transformations
- Fast execution, no external dependencies

### Integration Tests
- Test interaction between layers
- Use real database or test doubles
- Verify layer contracts and boundaries
- Test transaction boundaries

### End-to-End Tests
- Test complete user flows
- Verify all layers work together
- Use production-like environment
- Cover critical business paths

## Performance Considerations

### Layer-Specific Optimizations

#### Presentation Layer
- Response caching and compression
- Pagination for large datasets
- Lazy loading and code splitting
- Debouncing and throttling

#### Service Layer
- Batch operations where possible
- Parallel execution for independent operations
- In-memory caching for frequently accessed data
- Event-driven async processing

#### Repository Layer
- Query optimization and indexing
- Connection pooling
- Prepared statements and query caching
- Efficient data mapping

## Migration Strategy

When refactoring existing code to follow these patterns:

1. **Identify layer violations** - Find code that crosses boundaries
2. **Extract to appropriate layer** - Move logic to correct layer
3. **Define interfaces** - Create contracts between layers
4. **Add tests** - Ensure behavior is preserved
5. **Refactor incrementally** - Small, safe changes
6. **Document decisions** - Explain architectural choices

## App-Specific Patterns

Each application may extend these principles with technology-specific implementations:

- **API App**: See `apps/api/docs/standards/architecture.md` for Fastify, Drizzle, PostgreSQL patterns
- **Web App**: See `apps/web/docs/standards/architecture.md` for React Router, React Query, Zustand patterns
- **Docs App**: See `apps/docs/AGENTS.md` for Docusaurus-specific patterns
