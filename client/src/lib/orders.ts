import type { QueryClient } from "@tanstack/react-query";
import type { OrderWithServices } from "@shared/schema";

export type OrderListParams = {
  page: number;
  pageSize?: number;
  search?: string;
  status?: string;
  /** "requests" = orders waiting for payment verification / pay-later approval (admin, support). */
  view?: "requests" | "board";
  designerId?: string;
  orderType?: string;
  period?: "today" | "month" | "all";
  year?: number;
  month?: number; // 1-12
};

export type OrderPage = { rows: OrderWithServices[]; total: number; page: number; pageSize: number };

export type OrderPick = {
  id: number;
  orderNumber: string | null;
  clientName: string;
  status: string;
  assignedToId: number | null;
  assigneeName: string | null;
  remainingAmount?: number | null;
  createdAt?: string | null;
};

export function toQueryString(params: Record<string, unknown>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === "all") continue;
    qs.set(key, String(value));
  }
  return qs.toString();
}

/** All order-list caches start with this key, so invalidating ["/api/orders"] refreshes every page. */
export const orderListKey = (params: OrderListParams) => ["/api/orders", "list", params] as const;

export async function fetchOrderPage(params: OrderListParams): Promise<OrderPage> {
  const res = await fetch(`/api/orders?${toQueryString(params)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchOrderByRef(ref: string): Promise<OrderWithServices | null> {
  const res = await fetch(`/api/orders/ref/${encodeURIComponent(ref)}`, { credentials: "include" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchOrderById(id: number): Promise<OrderWithServices | null> {
  const res = await fetch(`/api/orders/${id}`, { credentials: "include" });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

/** Patch one order in every cached list page (no refetch of the list). */
export function patchOrderInCaches(queryClient: QueryClient, id: number, patch: (order: OrderWithServices) => OrderWithServices) {
  queryClient.setQueriesData<OrderPage>({ queryKey: ["/api/orders", "list"] }, old =>
    old ? { ...old, rows: old.rows.map(o => (o.id === id ? patch(o) : o)) } : old,
  );
}

export function snapshotOrderCaches(queryClient: QueryClient) {
  return queryClient.getQueriesData<OrderPage>({ queryKey: ["/api/orders", "list"] });
}

export function restoreOrderCaches(queryClient: QueryClient, snapshot: ReturnType<typeof snapshotOrderCaches>) {
  for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
}
