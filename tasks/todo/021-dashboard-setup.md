# 021: Dashboard Setup

## Summary
Set up the React dashboard with Vite 8, TanStack Query, TanStack Router, Tailwind CSS 4, and shadcn/ui.

## Dependencies
- 001-project-setup

## Acceptance Criteria

- [ ] Vite 8 configured for React + TypeScript
- [ ] TanStack Query setup:
  - QueryClient configured
  - QueryClientProvider at root
  - Default stale time and refetch settings
- [ ] TanStack Router setup:
  - File-based routing configured
  - Root layout with outlet
  - Type-safe route definitions
- [ ] Tailwind CSS 4 configured:
  - `@tailwindcss/vite` plugin added to `vite.config.ts` (no PostCSS/Autoprefixer needed)
  - CSS-first config: `@import "tailwindcss"` in `index.css`
  - Theme customization via `@theme` in CSS (no `tailwind.config.js`)
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
- Tailwind 4 uses CSS-first config: define shadcn theme tokens with `@theme` / CSS variables in `index.css` rather than a JS config
- Ensure shadcn/ui init targets Tailwind 4 (no `tailwind.config.js`); use the CSS-variables theming mode in `components.json`

## Files to Create/Modify

```
packages/dashboard/
├── package.json
├── vite.config.ts         # includes @tailwindcss/vite plugin
├── tsconfig.json
├── components.json        # shadcn config (CSS-variables theming)
├── index.html
└── src/
    ├── main.tsx
    ├── index.css          # @import "tailwindcss" + @theme tokens
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
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
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

## index.css (Tailwind 4)

```css
@import "tailwindcss";

@theme {
  /* shadcn/ui design tokens as CSS variables, e.g. */
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.145 0 0);
}
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
