# Documentation Site

Public documentation lives in `apps/docs` and is built with Docusaurus. Engineering standards stay
under root `docs/standards`; do not publish them by placing them in the Docusaurus content tree.

## Content

- Read `CONTEXT.md` before writing about Ledger domain concepts. Use its terms and capitalization.
- Write for the reader's task. Lead with the result, then supply the information needed to obtain it.
- Use short sentences, concrete nouns, and active voice. Remove repetition and filler.
- Keep one page title and a clear heading hierarchy.
- Use descriptive link text and useful alternative text for meaningful images.
- Include frontmatter only when Docusaurus or the surrounding section requires it.
- Verify commands, paths, request fields, and code examples against the current repository.

Document public behavior, not internal implementation steps, unless the page is explicitly for
contributors. Link to the canonical explanation instead of copying it into another page.

## Validation

```bash
pnpm --filter=@exchequerio/docs build
pnpm --filter=@exchequerio/docs lint
pnpm --filter=@exchequerio/docs types
```
