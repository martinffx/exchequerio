# Entity Pattern

Use this reference only when the owning package already uses entities or the
current task needs domain behavior that inferred Drizzle records cannot express.
Reuse canonical IDs, parsers, errors, and transformation helpers.

Domain entities encapsulate construction, business invariants, and typed
transformations between request, domain, and persistence shapes. Routes still
own HTTP validation and response serialization; repositories own database I/O.

## Core Concept

Established entities may expose three transformation methods:

1. `fromRequest(rq)` - API request → Entity
2. `fromRow(row)` - Database row → Entity
3. `toRow()` - Entity → Database insert/update row

Use type-only imports for the request and inferred Drizzle types. This keeps the
boundary types canonical without moving Fastify or database dependencies into
the domain model.

## Basic Entity

```typescript
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { users } from '../schema'
import type { CreateUserRequest } from '../routes/users/schema'

// Infer types from schema
type UserRow = InferSelectModel<typeof users>
type UserInsert = InferInsertModel<typeof users>

interface UserEntityData {
  id: string
  name: string
  email: string
  createdAt: Date
  updatedAt: Date
}

export class UserEntity {
  public readonly id: string
  public readonly name: string
  public readonly email: string
  public readonly createdAt: Date
  public readonly updatedAt: Date

  // Private constructor enforces factory methods
  private constructor(data: UserEntityData) {
    this.id = data.id
    this.name = data.name
    this.email = data.email
    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
  }

  // 1. API request → Entity
  static fromRequest(rq: CreateUserRequest, id?: string): UserEntity {
    const now = new Date()
    return new UserEntity({
      id: id ?? crypto.randomUUID(),
      name: rq.name,
      email: rq.email,
      createdAt: now,
      updatedAt: now,
    })
  }

  // 2. DB row → Entity
  static fromRow(row: UserRow): UserEntity {
    return new UserEntity({
      id: row.id,
      name: row.name,
      email: row.email,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }

  // 3. Entity → DB row
  toRow(): UserInsert {
    return {
      id: this.id,
      name: this.name,
      email: this.email,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    }
  }
}
```

The route maps `UserEntity` to its declared response schema and formats dates for
HTTP.

## Entity with TypeID

Using TypeID for type-safe prefixed identifiers:

```typescript
import { TypeID } from 'typeid-js'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { users } from '../schema'
import type { CreateUserRequest } from '../routes/users/schema'

type UserID = TypeID<'usr'>
type UserRow = InferSelectModel<typeof users>
type UserInsert = InferInsertModel<typeof users>

export class UserEntity {
  public readonly id: UserID
  public readonly name: string
  public readonly email: string

  private constructor(data: {
    id: UserID
    name: string
    email: string
  }) {
    this.id = data.id
    this.name = data.name
    this.email = data.email
  }

  static fromRequest(rq: CreateUserRequest, id?: string): UserEntity {
    return new UserEntity({
      id: id ? TypeID.fromString<'usr'>(id) : new TypeID('usr'),
      name: rq.name,
      email: rq.email,
    })
  }

  static fromRow(row: UserRow): UserEntity {
    return new UserEntity({
      id: TypeID.fromString<'usr'>(row.id),
      name: row.name,
      email: row.email,
    })
  }

  toRow(): UserInsert {
    return {
      id: this.id.toString(),  // TypeID → string for DB
      name: this.name,
      email: this.email,
    }
  }
}
```

## Entity with JSON Fields

Handle JSON serialization/deserialization:

```typescript
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { users } from '../schema'
import type { CreateUserRequest } from '../routes/users/schema'

type UserMetadata = {
  theme: 'light' | 'dark'
  notifications: boolean
}

type UserRow = InferSelectModel<typeof users>
type UserInsert = InferInsertModel<typeof users>

export class UserEntity {
  public readonly id: string
  public readonly name: string
  public readonly metadata?: UserMetadata

  private constructor(data: {
    id: string
    name: string
    metadata?: UserMetadata
  }) {
    this.id = data.id
    this.name = data.name
    this.metadata = data.metadata
  }

  static fromRequest(rq: CreateUserRequest, id?: string): UserEntity {
    return new UserEntity({
      id: id ?? crypto.randomUUID(),
      name: rq.name,
      metadata: rq.metadata,  // Already typed from API schema
    })
  }

  static fromRow(row: UserRow): UserEntity {
    // Parse JSON string from TEXT column
    let metadata: UserMetadata | undefined
    if (row.metadata) {
      metadata = JSON.parse(row.metadata)
    }

    return new UserEntity({
      id: row.id,
      name: row.name,
      metadata,
    })
  }

  toRow(): UserInsert {
    return {
      id: this.id,
      name: this.name,
      // Serialize to JSON string for TEXT column
      metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
    }
  }
}
```

## Entity with Business Logic

Entities can contain domain logic that operates on their data:

```typescript
import { TypeID } from 'typeid-js'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { ledgerAccounts } from '../schema'

type LedgerAccountID = TypeID<'lat'>
type LedgerAccountRow = InferSelectModel<typeof ledgerAccounts>
type LedgerAccountInsert = InferInsertModel<typeof ledgerAccounts>

export class LedgerAccountEntity {
  public readonly id: LedgerAccountID
  public readonly name: string
  public readonly normalBalance: 'debit' | 'credit'
  public readonly postedAmount: number
  public readonly lockVersion: number
  public readonly updated: Date

  private constructor(data: {
    id: LedgerAccountID
    name: string
    normalBalance: 'debit' | 'credit'
    postedAmount: number
    lockVersion: number
    updated: Date
  }) {
    Object.assign(this, data)
  }

  static fromRow(row: LedgerAccountRow): LedgerAccountEntity {
    return new LedgerAccountEntity({
      id: TypeID.fromString<'lat'>(row.id),
      name: row.name,
      normalBalance: row.normalBalance as 'debit' | 'credit',
      postedAmount: row.postedAmount,
      lockVersion: row.lockVersion,
      updated: row.updated,
    })
  }

  /**
   * Apply a transaction entry and return a new immutable entity.
   * Uses double-entry accounting rules based on the account's normal balance.
   */
  applyEntry(entry: {
    direction: 'debit' | 'credit'
    amount: number
  }): LedgerAccountEntity {
    let newPostedAmount = this.postedAmount

    if (this.normalBalance === 'debit') {
      if (entry.direction === 'debit') {
        newPostedAmount += entry.amount  // Debit increases debit accounts
      } else {
        newPostedAmount -= entry.amount  // Credit decreases debit accounts
      }
    } else {
      // credit normal balance
      if (entry.direction === 'credit') {
        newPostedAmount += entry.amount  // Credit increases credit accounts
      } else {
        newPostedAmount -= entry.amount  // Debit decreases credit accounts
      }
    }

    // Return new immutable instance
    return new LedgerAccountEntity({
      ...this,
      postedAmount: newPostedAmount,
      updated: new Date(),
    })
  }

  toRow(): LedgerAccountInsert {
    return {
      id: this.id.toString(),
      name: this.name,
      normalBalance: this.normalBalance,
      postedAmount: this.postedAmount,
      lockVersion: this.lockVersion,
      updated: this.updated,
    }
  }
}
```

## Entity with Defaults

Handle default values consistently:

```typescript
import type { LedgerRequest } from '../routes/ledgers/schema'

export class LedgerEntity {
  public readonly id: LedgerID
  public readonly organizationId: OrgID
  public readonly name: string
  public readonly currency: string
  public readonly currencyExponent: number
  public readonly metadata?: Record<string, unknown>

  private constructor(data: LedgerEntityData) {
    Object.assign(this, data)
  }

  static fromRequest(
    rq: LedgerRequest,
    organizationId: OrgID,
    id?: string
  ): LedgerEntity {
    return new LedgerEntity({
      id: id ? TypeID.fromString<'lgr'>(id) : new TypeID('lgr'),
      organizationId,
      name: rq.name,
      currency: rq.currency ?? 'USD',  // Apply default
      currencyExponent: rq.currencyExponent ?? 2,  // Apply default
      metadata: rq.metadata,
    })
  }

  static fromRow(row: LedgerRow): LedgerEntity {
    let metadata: Record<string, unknown> | undefined
    if (row.metadata) {
      metadata = JSON.parse(row.metadata)
    }

    return new LedgerEntity({
      id: TypeID.fromString<'lgr'>(row.id),
      organizationId: TypeID.fromString<'org'>(row.organizationId),
      name: row.name,
      currency: row.currency,
      currencyExponent: row.currencyExponent,
      metadata,
    })
  }

  toRow(): LedgerInsert {
    return {
      id: this.id.toString(),
      organizationId: this.organizationId.toString(),
      name: this.name,
      currency: this.currency,
      currencyExponent: this.currencyExponent,
      metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
    }
  }
}
```

## Guidelines

1. Follow the owning package's current entity shape and transformation boundaries.
2. Keep construction, invariant-preserving changes, and typed request or row
   decoding on the entity.
3. Reuse canonical IDs and constructors; do not introduce TypeID beside an existing ID system.
4. Prefer inferred rows when no domain behavior justifies an Entity class.
5. Keep HTTP serialization in routes and all Drizzle I/O in repositories.
