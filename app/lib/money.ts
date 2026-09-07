
export function formatMoney(
  amount: string | number | null | undefined,
  currencyCode: string | null | undefined,
): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";
  const code = currencyCode || "VND";
  try {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: code,
      maximumFractionDigits: code === "VND" ? 0 : 2,
    }).format(value);
  } catch {
    
    return `${value.toLocaleString("vi-VN")} ${code}`;
  }
}
