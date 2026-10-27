import type { EventKey } from "../shared/events";
import type { House, HouseInput } from "../shared/houses";

export interface Config {
  mapsApiKey: string;
  mapIds: Record<EventKey, string>;
  turnstileSiteKey: string;
}

export interface Created {
  id: string;
  editToken: string;
  eventDate: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    let message = "Midagi läks valesti. Proovi hiljem uuesti.";
    try {
      message = (await res.json()).error ?? message;
    } catch {
      // keep the generic message
    }
    throw new ApiError(res.status, message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const housePath = (id: string) => `/api/houses/${encodeURIComponent(id)}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export const api = {
  config: () => request<Config>("/api/config"),
  houses: (event: EventKey) => request<{ eventDate: string; houses: House[] }>(`/api/houses?event=${event}`),
  house: (id: string) => request<House>(housePath(id)),
  create: (input: HouseInput) => request<Created>("/api/houses", { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, token: string, input: HouseInput) =>
    request<House>(housePath(id), { method: "PATCH", headers: auth(token), body: JSON.stringify(input) }),
  remove: (id: string, token: string) => request<void>(housePath(id), { method: "DELETE", headers: auth(token) }),
  report: (id: string) => request<void>(`${housePath(id)}/report`, { method: "POST" }),
};
