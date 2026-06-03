import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const queryClient = new QueryClient();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <h1 className="text-2xl font-semibold">TypeScript Symphony</h1>
      </main>
    </QueryClientProvider>
  </StrictMode>,
);
