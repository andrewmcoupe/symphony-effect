import type { IssueDetail, StateSnapshot } from "./types";

const apiBaseUrl = import.meta.env.VITE_SYMPHONY_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const apiUrl = (path: string): string => `${apiBaseUrl}${path}`;

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(apiUrl(path), {
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    throw new ApiError(
      `Request failed with ${response.status} ${response.statusText}`,
      response.status,
      response.statusText,
    );
  }

  return (await response.json()) as T;
};

export const fetchState = (): Promise<StateSnapshot> => fetchJson<StateSnapshot>("/api/v1/state");

export const fetchIssue = (identifier: string): Promise<IssueDetail> =>
  fetchJson<IssueDetail>(`/api/v1/issues/${encodeURIComponent(identifier)}`);

export const triggerRefresh = async (): Promise<void> => {
  await fetchJson<{ readonly refreshRequested: boolean }>("/api/v1/refresh", {
    method: "POST",
  });
};
