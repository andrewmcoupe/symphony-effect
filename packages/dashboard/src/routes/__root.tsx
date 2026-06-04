import { Link, Outlet, createRootRoute } from "@tanstack/react-router";

import { useOrchestratorEvents } from "@/hooks";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  useOrchestratorEvents();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="text-base font-semibold">
            Symphony
          </Link>
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link
              to="/"
              className="rounded-md px-3 py-2 transition-colors hover:bg-accent hover:text-accent-foreground"
              activeProps={{
                className: "rounded-md bg-accent px-3 py-2 text-accent-foreground",
              }}
            >
              Overview
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
