import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IssueDetail, StateSnapshot } from "@/api/types";
import {
  issueDetailQueryKey,
  orchestratorStateQueryKey,
  useIssueDetail,
  useOrchestratorState,
  useRefreshMutation,
} from "@/hooks";

const stateSnapshot: StateSnapshot = {
  running: [
    {
      issueId: "issue-1",
      identifier: "ABC-1",
      turnCount: 2,
      startedAt: "2026-01-01T00:00:00.000Z",
      elapsedMs: 12_000,
      state: "In Progress",
    },
  ],
  retrying: [],
  tokenTotals: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    runtimeSeconds: 4,
  },
  config: {
    pollingIntervalMs: 5_000,
    maxConcurrentAgents: 3,
  },
  lastPollAt: "2026-01-01T00:00:05.000Z",
  shutdownRequested: false,
  agentOutputs: [],
};

const issueDetail: IssueDetail = {
  identifier: "ABC/1",
  status: "idle",
  state: "Todo",
  agentOutputs: [],
};

const makeJsonResponse = (body: unknown, init?: ResponseInit): Promise<Response> =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status: 200,
      ...init,
    }),
  );

const makeDeferredResponse = () => {
  let resolveResponse!: (response: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });

  return {
    promise,
    resolve: resolveResponse,
  };
};

const makeQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
      },
    },
  });

const makeWrapper =
  (queryClient: QueryClient) =>
  ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("dashboard API hooks", () => {
  it("fetches orchestrator state and exposes loading and data states", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => makeJsonResponse(stateSnapshot));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = makeQueryClient();

    const { result } = renderHook(() => useOrchestratorState(), {
      wrapper: makeWrapper(queryClient),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/state", {
      headers: {
        Accept: "application/json",
      },
    });
    expect(result.current.data).toEqual(stateSnapshot);
  });

  it("fetches issue details with an encoded identifier", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => makeJsonResponse(issueDetail));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = makeQueryClient();

    const { result } = renderHook(() => useIssueDetail("ABC/1"), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/issues/ABC%2F1", {
      headers: {
        Accept: "application/json",
      },
    });
    expect(queryClient.getQueryData(issueDetailQueryKey("ABC/1"))).toEqual(issueDetail);
  });

  it("surfaces network and HTTP errors through query state", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      makeJsonResponse(
        { error: "unavailable" },
        { status: 503, statusText: "Service Unavailable" },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = makeQueryClient();

    const { result } = renderHook(() => useOrchestratorState(), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("Request failed with 503 Service Unavailable");
  });

  it("optimistically updates state while refresh is pending", async () => {
    const deferred = makeDeferredResponse();
    const fetchMock = vi.fn<typeof fetch>(() => deferred.promise);
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = makeQueryClient();
    queryClient.setQueryData(orchestratorStateQueryKey, stateSnapshot);

    const { result } = renderHook(() => useRefreshMutation(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() => result.current.mutate());

    await waitFor(() =>
      expect(
        queryClient.getQueryData<StateSnapshot>(orchestratorStateQueryKey)?.lastPollAt,
      ).not.toBe(stateSnapshot.lastPollAt),
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/refresh", {
      headers: {
        Accept: "application/json",
      },
      method: "POST",
    });

    deferred.resolve(
      new Response(JSON.stringify({ refreshRequested: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls back optimistic state when refresh fails", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      makeJsonResponse({ error: "failed" }, { status: 500, statusText: "Internal Server Error" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = makeQueryClient();
    queryClient.setQueryData(orchestratorStateQueryKey, stateSnapshot);

    const { result } = renderHook(() => useRefreshMutation(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() => result.current.mutate());

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(orchestratorStateQueryKey)).toEqual(stateSnapshot);
  });
});
