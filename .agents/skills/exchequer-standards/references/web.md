# Customer Portal

The customer portal lives in `apps/web`. It uses React Router framework mode, React, and Tailwind.
Confirm versions and available commands in `apps/web/package.json`.

## Boundaries

- Keep route modules and route composition in `apps/web/app/routes`.
- Use loaders for route data and actions for route mutations.
- Use React Router forms and navigation state for submission and pending UI.
- Keep reusable UI in `apps/web/app/components`.
- Keep shared helpers in `apps/web/app/lib`.

Prefer server and route state over a new client state layer. Use local component state for local
interaction. Do not introduce a state, data-fetching, form, or component library unless the current
requirement and package manifest support it.

Use semantic HTML and preserve keyboard operation and visible focus. Keep Tailwind classes close to
the component they style; extract a component when the markup has a real reusable role.

## Validation

```bash
pnpm --filter=@exchequerio/web build
pnpm --filter=@exchequerio/web lint
pnpm --filter=@exchequerio/web types
```
