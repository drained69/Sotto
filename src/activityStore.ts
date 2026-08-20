export type StoredActivity = {
  hash: string;
  label: string;
  category: "Deposit" | "Yield" | "Transfer" | "Withdraw";
  status: "Confirming" | "Confirmed" | "Reverted";
  createdAt: string;
  amount?: string;
  destination?: string;
};

const PREFIX = "sotto.activity.v1";
const LIMIT = 100;

export function activityKey(address: string, chainId: string): string {
  return `${PREFIX}:${chainId.toLowerCase()}:${address.toLowerCase()}`;
}

export function loadActivity(storage: Pick<Storage, "getItem">, key: string): StoredActivity[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StoredActivity => {
      if (!item || typeof item !== "object") return false;
      const record = item as Partial<StoredActivity>;
      return typeof record.hash === "string"
        && typeof record.label === "string"
        && typeof record.createdAt === "string"
        && ["Deposit", "Yield", "Transfer", "Withdraw"].includes(record.category ?? "")
        && ["Confirming", "Confirmed", "Reverted"].includes(record.status ?? "");
    }).slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function saveActivity(storage: Pick<Storage, "setItem">, key: string, items: StoredActivity[]): void {
  try {
    storage.setItem(key, JSON.stringify(items.slice(0, LIMIT)));
  } catch {
    // Storage can be unavailable in private browsing. The in-memory ledger still works.
  }
}
