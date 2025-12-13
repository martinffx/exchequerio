# Documentation Content Standards

## Writing Style

### Voice & Tone
- **Active voice**: "Create a ledger" not "A ledger is created"
- **Direct address**: Use "you" to speak directly to readers
- **Conversational but professional**: Friendly without being casual
- **Concise**: Short sentences and paragraphs (2-3 sentences max)

### Language Guidelines
- **Use simple language**: Avoid jargon unless necessary
- **Define technical terms**: Explain concepts when first introduced
- **Be specific**: "Click the Save button" not "Click the button"
- **Avoid ambiguity**: "The API returns a 404 error" not "It might fail"

### Examples

```markdown
✅ Good:
Create a new ledger by sending a POST request to `/api/ledgers`.

❌ Avoid:
A ledger can be created through the submission of a POST request that would be directed to the `/api/ledgers` endpoint.
```

## Content Structure

### Page Organization

```markdown
---
sidebar_position: 1
title: Getting Started
description: Learn how to set up and use the Exchequer API
---

# Getting Started

Brief introduction (1-2 sentences about what this page covers).

## Prerequisites

- List required knowledge
- List required tools
- List required setup

## Step-by-Step Guide

### Step 1: Title

Clear instructions...

### Step 2: Title

More instructions...

## Next Steps

- Link to related documentation
- Suggest logical next steps
```

### Headings

- **H1 (`#`)**: Page title only (one per page)
- **H2 (`##`)**: Major sections
- **H3 (`###`)**: Subsections
- **H4 (`####`)**: Rarely needed, avoid deep nesting

```markdown
# Page Title (H1)

## Major Section (H2)

### Subsection (H3)

Content...

## Another Major Section (H2)
```

## Code Examples

### Code Blocks

````markdown
```typescript
// Always include syntax highlighting
interface User {
  id: string
  name: string
}
```

```typescript title="user.ts"
// Include filename for context
export function getUser(id: string): User {
  // Implementation
}
```

```typescript {2-4}
// Highlight important lines
function example() {
  const important = "highlighted"
  const critical = "also highlighted"
  const context = "regular"
}
```
````

### Example Quality

```markdown
✅ Good: Complete, runnable examples
```typescript
// Create a ledger account
const account = await fetch("/api/ledgers/123/accounts", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "User Wallet",
    type: "debit"
  })
})
```

❌ Avoid: Incomplete snippets
```typescript
// Missing context
fetch(url, options)
```
```

### Code Comments

- **Use comments** to explain "why", not "what"
- **Keep comments minimal** - code should be self-documenting
- **Add context** when necessary

```typescript
// ✅ Good: Explains why
// Retry failed requests to handle transient network errors
const result = await retryRequest(request, { maxAttempts: 3 })

// ❌ Avoid: States the obvious
// Call the retryRequest function
const result = await retryRequest(request, { maxAttempts: 3 })
```

## Markdown Conventions

### Lists

```markdown
<!-- Unordered lists: Use hyphens -->
- First item
- Second item
  - Nested item (2 spaces indent)
  - Another nested item
- Third item

<!-- Ordered lists: Use numbers -->
1. First step
2. Second step
3. Third step

<!-- Task lists -->
- [x] Completed task
- [ ] Pending task
```

### Links

```markdown
<!-- Internal links: Relative paths -->
See the [Getting Started](./getting-started.md) guide.

<!-- External links: Full URLs -->
Learn more about [REST APIs](https://restfulapi.net/).

<!-- Reference-style links for repeated URLs -->
Check out the [API docs][api] and [SDK docs][sdk].

[api]: https://api.exchequer.io
[sdk]: https://github.com/exchequer/sdk
```

### Images

```markdown
<!-- Always include alt text -->
![Architecture diagram showing the layered approach](./architecture.png)

<!-- Not just -->
![](./architecture.png)

<!-- Images from static directory -->
![Exchequer logo](/img/logo.png)

<!-- With caption using emphasis -->
![Database schema](./schema.png)
*Figure 1: Entity relationship diagram*
```

### Tables

```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Value 1  | Value 2  | Value 3  |
| Value 4  | Value 5  | Value 6  |

<!-- Align columns -->
| Left | Center | Right |
|:-----|:------:|------:|
| Text | Text   | Text  |
```

## Admonitions

Use admonitions to highlight important information:

```markdown
:::note
Additional context or clarification.
:::

:::tip
Helpful suggestions or best practices.
:::

:::warning
Important warnings about potential issues.
:::

:::danger
Critical warnings about destructive actions.
:::

:::info
General information or FYI content.
:::
```

### When to Use Each Type

- **Note**: Supplementary information, clarifications
- **Tip**: Best practices, shortcuts, optimizations
- **Warning**: Potential issues, common mistakes
- **Danger**: Data loss, security issues, irreversible actions
- **Info**: General information, updates, announcements

## API Documentation

### Endpoint Documentation

```markdown
## Create Ledger

Creates a new ledger for tracking financial transactions.

**Endpoint:** `POST /api/ledgers`

**Authentication:** Required (Bearer token)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Ledger name |
| `currency` | string | Yes | ISO 4217 currency code |
| `description` | string | No | Optional description |

**Example Request:**

```typescript
const response = await fetch("/api/ledgers", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_TOKEN",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    name: "Main Ledger",
    currency: "USD",
    description: "Primary accounting ledger"
  })
})
```

**Example Response:**

```json
{
  "id": "led_123",
  "name": "Main Ledger",
  "currency": "USD",
  "description": "Primary accounting ledger",
  "created_at": "2024-01-15T10:30:00Z"
}
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid request data |
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 409 | `DUPLICATE_NAME` | Ledger name already exists |
```

## Frontmatter

Always include frontmatter for documentation pages:

```markdown
---
sidebar_position: 1
title: Page Title
description: Brief description for SEO and preview
keywords: [keyword1, keyword2, keyword3]
---
```

### Frontmatter Fields

- **sidebar_position**: Number for sidebar ordering (lower = higher)
- **title**: Page title (used in sidebar and metadata)
- **description**: Brief summary for SEO
- **keywords**: Array of relevant search keywords
- **slug**: Custom URL slug (optional)
- **hide_title**: Hide H1 title from page (optional)

## Accessibility

### Alt Text

```markdown
<!-- ✅ Good: Descriptive alt text -->
![Bar chart showing revenue growth from 2020 to 2024](./revenue-chart.png)

<!-- ❌ Avoid: Generic alt text -->
![chart](./revenue-chart.png)
![image](./revenue-chart.png)
```

### Link Text

```markdown
<!-- ✅ Good: Descriptive link text -->
Learn more about [authentication and authorization](./auth.md).

<!-- ❌ Avoid: Generic link text -->
Click [here](./auth.md) to learn more.
```

### Headings

- **Use semantic order**: Don't skip levels (H2 → H4)
- **Make headings descriptive**: "API Authentication" not "Auth"
- **Avoid duplicate headings**: Each heading should be unique

## File Naming

### Documentation Files

```
docs/
├── intro.md                  # kebab-case
├── getting-started.md
├── api/
│   ├── authentication.md
│   ├── error-handling.md
│   └── rate-limiting.md
└── guides/
    ├── creating-ledgers.md
    └── managing-transactions.md
```

### Image Files

```
static/img/
├── logo.png                  # kebab-case
├── architecture-diagram.png
└── guides/
    ├── create-ledger-form.png
    └── transaction-flow.png
```

## Version Control

### Documentation Updates

- **Update docs with code changes**: Keep docs in sync
- **Use meaningful commit messages**: "docs: add rate limiting guide"
- **Review for accuracy**: Verify examples still work
- **Check links**: Ensure internal links aren't broken

### Change Log

Document breaking changes and major updates:

```markdown
---
title: API Changelog
---

## Version 2.0.0 (2024-01-15)

### Breaking Changes

- Authentication now requires Bearer tokens instead of API keys
- Removed deprecated `/v1/accounts` endpoint

### New Features

- Added `/api/ledgers` endpoint for ledger management
- Introduced webhook support for real-time updates

### Improvements

- Improved error messages with detailed field-level validation
```

## Content Review Checklist

Before publishing documentation:

- [ ] Title and description are clear and accurate
- [ ] Headings use proper hierarchy (H1 → H2 → H3)
- [ ] Code examples are complete and runnable
- [ ] Links are working (no 404s)
- [ ] Images have descriptive alt text
- [ ] Admonitions are used appropriately
- [ ] Frontmatter is complete
- [ ] No typos or grammatical errors
- [ ] Content is concise and easy to scan
- [ ] Examples follow current best practices

## Style Guide Quick Reference

### Capitalization

- **Headings**: Title case ("Getting Started with Exchequer")
- **Product names**: Exchequer (capitalized)
- **Technical terms**: API, REST, JSON, HTTP (all caps)
- **Code**: Follow language conventions (camelCase, PascalCase)

### Formatting

- **File names**: `code formatting`
- **UI elements**: **Bold** ("Click the **Save** button")
- **Keyboard keys**: `Ctrl+C`, `Enter`
- **Variables**: `variable_name` or *emphasis*
- **Important terms**: **bold** on first use

### Numbers

- **Numbers 1-9**: Spell out ("three steps")
- **Numbers 10+**: Use numerals ("15 items")
- **Technical values**: Always use numerals ("5 retries", "1 second")

### Punctuation

- **Oxford comma**: Use it ("API, SDK, and CLI")
- **Periods**: End complete sentences with periods
- **Colons**: Introduce lists or explanations
- **Hyphens**: Use for compound adjectives ("real-time updates")

## Resources

- [Markdown Guide](https://www.markdownguide.org/)
- [Docusaurus Documentation](https://docusaurus.io/docs)
- [Google Developer Documentation Style Guide](https://developers.google.com/style)
- [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/welcome/)
