# Docs App Agent Development Guide

## Product Documentation

- **Product Overview**: See `/docs/product/product.md` for overall platform vision
- **Roadmap**: See `/docs/product/roadmap.md` for feature priorities
- **Architecture Standards**: See `/docs/standards/architecture.md` for layered architecture principles
- **Coding Standards**: See `/docs/standards/coding.md` for TypeScript and TDD patterns
- **Docs-Specific Standards**: See `apps/docs/docs/standards/` for content guidelines

## Tech Stack

- **Framework:** Docusaurus
- **Content:** Markdown with MDX support
- **Styling:** Infima (Docusaurus default) with custom CSS
- **Code Quality:** Biome + ESLint

## Commands

### **Development**
```bash
# From monorepo root
bun run dev:docs         # Start docs site only
bun run dev              # Start all apps

# From apps/docs directory
bun run dev              # Start development server (http://localhost:3000)
```

### **Build**
```bash
# From monorepo root
bun --filter=@exchequerio/docs build

# From apps/docs directory
bun run build            # Build static site to /build
bun run serve            # Preview production build
```

### **Code Quality**
```bash
# From monorepo root
bun run check            # Run all quality checks

# From apps/docs directory
bun run format           # Format code with Biome
bun run lint             # Lint with Biome + ESLint
```

### **Deployment**
```bash
bun run build            # Build for production
# Deploy /build directory to hosting platform
```

## File Structure

```
apps/docs/
├── docs/                # Documentation pages (Markdown/MDX)
│   ├── intro.md
│   ├── guides/
│   └── api/
├── blog/                # Blog posts (optional)
├── src/
│   ├── components/      # Custom React components
│   ├── css/            # Custom styles
│   └── pages/          # Custom pages (React)
├── static/
│   └── img/            # Static images
├── docusaurus.config.ts # Docusaurus configuration
├── sidebars.ts          # Sidebar configuration
└── package.json
```

## Content Structure

### Adding Documentation Pages

```bash
# Create new doc file
touch docs/guides/getting-started.md

# Add frontmatter
---
sidebar_position: 1
title: Getting Started
---

# Getting Started

Your content here...
```

### Sidebar Configuration

```typescript
// sidebars.ts
import type { SidebarsConfig } from "@docusaurus/plugin-content-docs"

const sidebars: SidebarsConfig = {
  docs: [
    "intro",
    {
      type: "category",
      label: "Guides",
      items: ["guides/getting-started", "guides/installation"]
    }
  ]
}

export default sidebars
```

### Docusaurus Configuration

```typescript
// docusaurus.config.ts
import type { Config } from "@docusaurus/types"

const config: Config = {
  title: "Exchequer Documentation",
  tagline: "Real-time ledger API for PSPs and Marketplaces",
  url: "https://docs.exchequer.io",
  baseUrl: "/",
  
  themeConfig: {
    navbar: {
      title: "Exchequer",
      items: [
        {
          type: "doc",
          docId: "intro",
          label: "Docs"
        }
      ]
    }
  }
}

export default config
```

## Writing Content

### Markdown Basics

```markdown
# Heading 1
## Heading 2
### Heading 3

**Bold text**
*Italic text*

- Bullet list
- Item 2

1. Numbered list
2. Item 2

[Link text](https://example.com)

![Image alt](./image.png)
```

### Code Blocks

````markdown
```typescript
// Code with syntax highlighting
function hello() {
  console.log("Hello, world!")
}
```

```typescript title="example.ts"
// With filename
export function greet(name: string) {
  return `Hello, ${name}!`
}
```

```typescript {2-3}
// With line highlighting
function example() {
  const important = "highlighted"
  const alsoImportant = "also highlighted"
  const normal = "not highlighted"
}
```
````

### Admonitions

```markdown
:::note
This is a note admonition.
:::

:::tip
This is a tip admonition.
:::

:::warning
This is a warning admonition.
:::

:::danger
This is a danger admonition.
:::

:::info
This is an info admonition.
:::
```

### MDX Features

```mdx
import MyComponent from '@site/src/components/MyComponent';

# Page Title

<MyComponent name="value" />

export const Highlight = ({children, color}) => (
  <span style={{backgroundColor: color}}>
    {children}
  </span>
);

This is <Highlight color="#25c2a0">highlighted text</Highlight>.
```

## Custom Components

### Creating Components

```typescript
// src/components/ApiEndpoint.tsx
export function ApiEndpoint({ method, path }: { method: string; path: string }) {
  return (
    <div className="api-endpoint">
      <span className="method">{method}</span>
      <code>{path}</code>
    </div>
  )
}
```

### Using in MDX

```mdx
import { ApiEndpoint } from '@site/src/components/ApiEndpoint';

# API Reference

<ApiEndpoint method="POST" path="/api/ledgers" />

Create a new ledger...
```

## Best Practices

### Content Organization

- **Group related docs** into categories using folders
- **Use descriptive file names** that match the content
- **Keep docs concise** - one topic per page
- **Link between docs** to help navigation

### Writing Style

- **Use active voice** - "Create a ledger" not "A ledger is created"
- **Be concise** - Short sentences and paragraphs
- **Use examples** - Show, don't just tell
- **Add code samples** - Demonstrate concepts with code

### Accessibility

- **Use semantic headings** - H1, H2, H3 in order
- **Add alt text** to images
- **Use descriptive link text** - Not "click here"
- **Test keyboard navigation**

### SEO

```markdown
---
title: Getting Started with Exchequer API
description: Learn how to integrate the Exchequer ledger API into your application
keywords: [ledger, api, integration, payment]
---
```

## Common Tasks

### Adding a New Guide

1. Create file: `docs/guides/my-guide.md`
2. Add frontmatter with title and position
3. Write content using Markdown/MDX
4. Add to sidebar in `sidebars.ts`
5. Preview with `bun run dev`

### Adding Images

```markdown
<!-- Relative path -->
![Architecture diagram](./diagrams/architecture.png)

<!-- From static directory -->
![Logo](/img/logo.png)
```

### Creating Blog Posts

```markdown
---
title: Announcing New Features
authors: [author-name]
tags: [feature, update]
---

Blog post content...

<!--truncate-->

More content after "Read more" link...
```

## Troubleshooting

### Common Issues

**Issue:** "Module not found" errors
- **Solution:** Check import paths use `@site/` prefix for src/ files

**Issue:** Sidebar not updating
- **Solution:** Restart dev server after changing `sidebars.ts`

**Issue:** Build fails with MDX errors
- **Solution:** Check MDX syntax, ensure JSX is valid

**Issue:** Images not loading
- **Solution:** Verify path (relative or `/img/` from static)

## Documentation Standards

See `apps/docs/docs/standards/coding.md` for:
- Markdown conventions
- Content style guide
- Code example formatting
- Documentation structure patterns
