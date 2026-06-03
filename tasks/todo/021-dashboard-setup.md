# 021: Dashboard Setup

## Summary
Set up the React dashboard with Vite, TanStack Query, TanStack Router, Tailwind, and shadcn/ui.

## Dependencies
- 001-project-setup

## Acceptance Criteria

- [ ] Vite configured for React + TypeScript
- [ ] TanStack Query setup:
  - QueryClient configured
  - QueryClientProvider at root
  - Default stale time and refetch settings
- [ ] TanStack Router setup:
  - File-based routing configured
  - Root layout with outlet
  - Type-safe route definitions
- [ ] Tailwind CSS configured:
  - `tailwind.config.js`
  - `postcss.config.js`
  - Base styles in `index.css`
- [ ] shadcn/ui initialized:
  - `components.json` configured
  - Base components installed (button, card, badge, table)
  - Dark mode support (class-based)
- [ ] Proxy configured for API:
  - Vite dev server proxies `/api/*` to orchestrator
- [ ] Base layout:
  - Header with "Symphony" title
  - Navigation placeholder
  - Main content area
- [ ] `pnpm -F dashboard dev` starts dev server
- [ ] `pnpm -F dashboard build` produces production build

## Technical Notes

- Use `@tanstack/react-router` with file-based routing
- Configure Vite proxy in `vite.config.ts`
- shadcn/ui uses `class-variance-authority` for variants
- Tailwind config should extend for shadcn theming

## Files to Create/Modify

```
packages/dashboard/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── components.json        # shadcn config
├── index.html
└── src/
    ├── main.tsx
    ├── index.css          # Tailwind imports
    ├── lib/
    │   └── utils.ts       # shadcn cn() utility
    ├── components/
    │   └── ui/            # shadcn components
    │       ├── button.tsx
    │       ├── card.tsx
    │       ├── badge.tsx
    │       └── table.tsx
    ├── routes/
    │   ├── __root.tsx     # Root layout
    │   └── index.tsx      # Home route
    └── routeTree.gen.ts   # Generated routes
```

## Vite Config

```typescript
export default defineConfig({
  plugins: [react(), TanStackRouterVite()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
```

## TanStack Query Setup

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchInterval: 5000,
    },
  },
})
```
