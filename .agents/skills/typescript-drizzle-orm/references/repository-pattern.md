# Repository Pattern

Use this reference only when the owning package already uses repositories or the
current task needs a stable abstraction over multiple queries. Do not add a
repository, error wrapper, retry layer, or entity conversion around a direct query
that already satisfies the active boundary.

## Core Concept

Repositories:
- Execute queries and transactions
- Apply tenant and optimistic-write predicates
- Classify database and driver errors at the I/O boundary
- Convert rows with entity `fromRow` and `toRow` methods

Services orchestrate use cases and decide whether to retry. Routes validate and
serialize HTTP data. Repositories do not absorb either responsibility.

## Basic Repository

```typescript
import { eq, and } from 'drizzle-orm'
import type { DrizzleDB } from '../db'
import { users } from '../schema'
import { UserEntity } from '../entities/UserEntity'
import { NotFoundError } from '../errors'

export class UserRepo {
  constructor(private db: DrizzleDB) {}

  async getById(id: string): Promise<UserEntity> {
    const record = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    })

    if (!record) {
      throw new NotFoundError('User not found', { userId: id })
    }

    return UserEntity.fromRow(record)
  }

  async list(): Promise<UserEntity[]> {
    const records = await this.db.query.users.findMany({
      orderBy: desc(users.createdAt),
    })

    return records.map(UserEntity.fromRow)
  }

  async create(entity: UserEntity): Promise<UserEntity> {
    const [record] = await this.db
      .insert(users)
      .values(entity.toRow())
      .returning()

    return UserEntity.fromRow(record)
  }

  async update(entity: UserEntity): Promise<UserEntity> {
    const [record] = await this.db
      .update(users)
      .set(entity.toRow())
      .where(eq(users.id, entity.id))
      .returning()

    if (!record) {
      throw new NotFoundError('User not found', { userId: entity.id })
    }

    return UserEntity.fromRow(record)
  }

  async delete(id: string): Promise<void> {
    const result = await this.db
      .delete(users)
      .where(eq(users.id, id))
      .returning()

    if (result.length === 0) {
      throw new NotFoundError('User not found', { userId: id })
    }
  }
}
```

## Repository with Error Handling

Classify PostgreSQL and driver errors at the repository boundary:

```typescript
import { eq } from 'drizzle-orm'
import type { DrizzleDB } from '../db'
import { users } from '../schema'
import { UserEntity } from '../entities/UserEntity'
import { handleDBError, NotFoundError } from '../errors'

export class UserRepo {
  constructor(private db: DrizzleDB) {}

  async create(entity: UserEntity): Promise<UserEntity> {
    try {
      const [record] = await this.db
        .insert(users)
        .values(entity.toRow())
        .returning()

      return UserEntity.fromRow(record)
    } catch (error) {
      // Maps DB errors (23505, 23503, etc) to domain errors
      throw handleDBError(error, { userId: entity.id })
    }
  }

  async update(entity: UserEntity): Promise<UserEntity> {
    try {
      const [record] = await this.db
        .update(users)
        .set(entity.toRow())
        .where(eq(users.id, entity.id))
        .returning()

      if (!record) {
        throw new NotFoundError('User not found', { userId: entity.id })
      }

      return UserEntity.fromRow(record)
    } catch (error) {
      throw handleDBError(error, { userId: entity.id })
    }
  }
}

// Repository-owned driver error classifier
type ErrorContext = {
  userId?: string
  resourceId?: string
  [key: string]: unknown
}

export function handleDBError(error: unknown, context: ErrorContext = {}): never {
  const code = (error as { code?: string }).code

  switch (code) {
    case '23505': // unique_violation
      throw new ConflictError('Resource already exists', context)
    case '23503': // foreign_key_violation
      throw new NotFoundError('Referenced resource not found', context)
    case '40001': // serialization_failure (Postgres)
      throw new ServiceUnavailableError('Transaction conflict - please retry', {
        retryable: true,
        ...context,
      })
    case 'OC000': // occ_conflict (AWS DSQL)
      throw new ServiceUnavailableError('Optimistic concurrency conflict', {
        retryable: true,
        ...context,
      })
    default:
      throw error
  }
}
```

## Repository with Multi-Tenancy

Enforce organization-level isolation:

```typescript
import { TypeID } from 'typeid-js'
import { eq, and } from 'drizzle-orm'
import type { DrizzleDB } from '../db'
import { ledgers } from '../schema'
import { LedgerEntity } from '../entities/LedgerEntity'
import { NotFoundError } from '../errors'

type OrgID = TypeID<'org'>
type LedgerID = TypeID<'lgr'>

export class LedgerRepo {
  constructor(private db: DrizzleDB) {}

  // ALWAYS include orgId in queries for multi-tenancy
  async getById(orgId: OrgID, ledgerId: LedgerID): Promise<LedgerEntity> {
    const record = await this.db.query.ledgers.findFirst({
      where: and(
        eq(ledgers.id, ledgerId.toString()),
        eq(ledgers.organizationId, orgId.toString())  // Multi-tenancy check
      ),
    })

    if (!record) {
      throw new NotFoundError('Ledger not found', {
        organizationId: orgId.toString(),
        ledgerId: ledgerId.toString(),
      })
    }

    return LedgerEntity.fromRow(record)
  }

  async list(orgId: OrgID): Promise<LedgerEntity[]> {
    const records = await this.db.query.ledgers.findMany({
      where: eq(ledgers.organizationId, orgId.toString()),
      orderBy: desc(ledgers.created),
    })

    return records.map(LedgerEntity.fromRow)
  }

  async create(entity: LedgerEntity): Promise<LedgerEntity> {
    try {
      const [record] = await this.db
        .insert(ledgers)
        .values(entity.toRow())
        .returning()

      return LedgerEntity.fromRow(record)
    } catch (error) {
      throw handleDBError(error, {
        organizationId: entity.organizationId.toString(),
        ledgerId: entity.id.toString(),
      })
    }
  }

  async update(orgId: OrgID, entity: LedgerEntity): Promise<LedgerEntity> {
    try {
      const [record] = await this.db
        .update(ledgers)
        .set(entity.toRow())
        .where(and(
          eq(ledgers.id, entity.id.toString()),
          eq(ledgers.organizationId, orgId.toString())  // Multi-tenancy check
        ))
        .returning()

      if (!record) {
        throw new NotFoundError('Ledger not found', {
          organizationId: orgId.toString(),
          ledgerId: entity.id.toString(),
        })
      }

      return LedgerEntity.fromRow(record)
    } catch (error) {
      throw handleDBError(error, {
        organizationId: orgId.toString(),
        ledgerId: entity.id.toString(),
      })
    }
  }

  async delete(orgId: OrgID, ledgerId: LedgerID): Promise<void> {
    const result = await this.db
      .delete(ledgers)
      .where(and(
        eq(ledgers.id, ledgerId.toString()),
        eq(ledgers.organizationId, orgId.toString())  // Multi-tenancy check
      ))
      .returning()

    if (result.length === 0) {
      throw new NotFoundError('Ledger not found', {
        organizationId: orgId.toString(),
        ledgerId: ledgerId.toString(),
      })
    }
  }
}
```

## Repository with Optimistic Locking

Handle concurrent updates safely:

```typescript
import { eq, and, sql } from 'drizzle-orm'
import type { DrizzleDB } from '../db'
import { users } from '../schema'
import { UserEntity } from '../entities/UserEntity'
import { ConflictError, NotFoundError } from '../errors'

export class UserRepo {
  constructor(private db: DrizzleDB) {}

  async update(entity: UserEntity): Promise<UserEntity> {
    try {
      const result = await this.db
        .update(users)
        .set({
          ...entity.toRow(),
          lockVersion: sql`${users.lockVersion} + 1`,  // Increment version
        })
        .where(and(
          eq(users.id, entity.id),
          eq(users.lockVersion, entity.lockVersion)  // Version check
        ))
        .returning()

      if (result.length === 0) {
        // Either not found or version mismatch
        const exists = await this.db.query.users.findFirst({
          where: eq(users.id, entity.id),
          columns: { id: true, lockVersion: true },
        })

        if (!exists) {
          throw new NotFoundError('User not found', { userId: entity.id })
        }

        // Version mismatch - resource was modified
        throw new ConflictError({
          message: 'Resource was modified by another transaction',
          retryable: true,  // Service layer can retry
          context: {
            userId: entity.id,
            expectedVersion: entity.lockVersion,
            actualVersion: exists.lockVersion,
          },
        })
      }

      return UserEntity.fromRow(result[0])
    } catch (error) {
      throw handleDBError(error, { userId: entity.id })
    }
  }
}
```

## Repository with Transactions

Repositories own the atomic write. The service supplies entities after applying
the use-case's domain transformations.

```typescript
import { eq, and, sql } from 'drizzle-orm'
import type { DrizzleDB } from '../db'
import {
  ledgerTransactions,
  ledgerTransactionEntries,
  ledgerAccounts,
} from '../schema'
import { LedgerTransactionEntity } from '../entities/LedgerTransactionEntity'
import type { LedgerAccountEntity } from '../entities/LedgerAccountEntity'
import { ConflictError } from '../errors'

export class LedgerTransactionRepo {
  constructor(private db: DrizzleDB) {}

  async save(
    transaction: LedgerTransactionEntity,
    updatedAccounts: ReadonlyArray<LedgerAccountEntity>
  ): Promise<LedgerTransactionEntity> {
    // Write the service-prepared entities atomically.
    return await this.db.transaction(async tx => {
      // Insert transaction record (with upsert for idempotency)
      const [txRecord] = await tx
        .insert(ledgerTransactions)
        .values(transaction.toRow())
        .onConflictDoUpdate({
          target: ledgerTransactions.idempotencyKey,
          set: { updated: new Date() },
        })
        .returning()

      // Insert transaction entries
      await tx.insert(ledgerTransactionEntries).values(
        transaction.entries.map(e => e.toRow())
      )

      // Update account balances with optimistic locking
      for (const account of updatedAccounts) {
        const result = await tx
          .update(ledgerAccounts)
          .set({
            ...account.toRow(),
            lockVersion: sql`${ledgerAccounts.lockVersion} + 1`,
          })
          .where(and(
            eq(ledgerAccounts.id, account.id.toString()),
            eq(ledgerAccounts.lockVersion, account.lockVersion)
          ))
          .returning()

        if (result.length === 0) {
          // Optimistic lock failure - another transaction modified this account
          throw new ConflictError({
            message: `Account ${account.id} was modified by another transaction`,
            retryable: true,  // Service layer will retry entire operation
            context: {
              accountId: account.id.toString(),
              transactionId: transaction.id.toString(),
            },
          })
        }
      }

      return LedgerTransactionEntity.fromRow(txRecord)
    })
  }
}
```

## Repository with Pagination

Cursor-based pagination for large datasets:

```typescript
import { gt, desc } from 'drizzle-orm'
import type { DrizzleDB } from '../db'
import { posts } from '../schema'
import { PostEntity } from '../entities/PostEntity'

interface PaginatedResult<T> {
  items: T[]
  nextCursor?: string
  hasMore: boolean
}

export class PostRepo {
  constructor(private db: DrizzleDB) {}

  async list(
    limit: number = 20,
    cursor?: string
  ): Promise<PaginatedResult<PostEntity>> {
    const queryLimit = limit + 1  // Fetch one extra to check hasMore

    const records = await this.db.query.posts.findMany({
      where: cursor ? gt(posts.id, cursor) : undefined,
      orderBy: desc(posts.createdAt),
      limit: queryLimit,
    })

    const hasMore = records.length > limit
    const items = records.slice(0, limit).map(PostEntity.fromRow)
    const nextCursor = hasMore ? records[limit - 1].id : undefined

    return {
      items,
      nextCursor,
      hasMore,
    }
  }
}
```

## Guidelines

1. Reuse the existing repository shape, database service, entities, and errors.
2. Preserve tenant filters and return contracts already owned by the boundary.
3. Use transactions and constraints for the current multi-step integrity need.
4. Add optimistic locking, idempotency, or pagination only when the active query
   or operational contract requires them.
5. Classify driver errors in the repository. Let the service decide whether a
   retry fits the use case.
