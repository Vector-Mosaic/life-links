import type { ExportBatchRecord, LinkRecord, ProjectRecord, QrViewState, UserRecord } from "@life-links/core";

export type ApiUser = Pick<UserRecord, "id" | "email" | "displayName" | "createdAt">;

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const bodyIsFormData = init.body instanceof FormData;
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      ...(bodyIsFormData ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.error ?? "api_error", body);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly body: unknown
  ) {
    super(code);
  }
}

export async function getConfig() {
  return apiFetch<{ qrBaseUrl: string; maxBatchCount: number }>("/api/config");
}

export async function getMe() {
  return apiFetch<{ user: ApiUser | null; qrBaseUrl: string }>("/api/me");
}

export async function login(email: string, password: string) {
  return apiFetch<{ user: ApiUser; qrBaseUrl: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function logout() {
  return apiFetch<void>("/api/auth/logout", { method: "POST" });
}

export async function listLinks() {
  return apiFetch<{ links: LinkRecord[] }>("/api/links");
}

export async function updateLink(
  qrId: string,
  patch: Pick<LinkRecord, "title" | "body" | "bodyDoc" | "bodyDocVersion" | "privacy" | "projectId">
) {
  return apiFetch<{ link: LinkRecord }>(`/api/links/${encodeURIComponent(qrId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export async function uploadLinkMedia(qrId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return apiFetch<{ media: LinkRecord["media"][number] }>(`/api/links/${encodeURIComponent(qrId)}/media`, {
    method: "POST",
    body
  });
}

export async function deleteLinkMedia(qrId: string, mediaId: string) {
  return apiFetch<void>(`/api/links/${encodeURIComponent(qrId)}/media/${encodeURIComponent(mediaId)}`, {
    method: "DELETE"
  });
}

export async function listProjects() {
  return apiFetch<{ projects: ProjectRecord[] }>("/api/projects");
}

export async function createProject(name: string) {
  return apiFetch<{ project: ProjectRecord }>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name })
  });
}

export async function createQrBatch(count: number) {
  return apiFetch<{ batch: ExportBatchRecord; qrCodes: LinkRecord[] }>("/api/qr-batches", {
    method: "POST",
    body: JSON.stringify({ count })
  });
}

export async function getQr(qrId: string) {
  return apiFetch<QrViewState>(`/api/qr/${encodeURIComponent(qrId)}`);
}

export async function claimQr(qrId: string, commandId: string) {
  return apiFetch<{ result: string; state: QrViewState }>(`/api/qr/${encodeURIComponent(qrId)}/claim`, {
    method: "POST",
    body: JSON.stringify({ commandId })
  });
}

export async function findScan(targetQrId: string, scanText: string) {
  return apiFetch<{ targetQrId: string; scannedQrId: string | null; match: boolean }>("/api/find/scan", {
    method: "POST",
    body: JSON.stringify({ targetQrId, scanText })
  });
}
