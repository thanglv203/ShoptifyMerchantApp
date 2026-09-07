import { PermanentError } from "../lib/errors";

export type PriceConstraint = {
  semanticQuery: string;
  minPrice: number | null;
  maxPrice: number | null;
};

const AMOUNT = String.raw`(\d[\d.,]*\s*(?:k|nghìn|nghin|ngàn|ngan|triệu|trieu|m)?\s*(?:₫|đ|vnd)?)`;

export function parsePriceAmount(raw: string): number | null {
  const normalized = raw
    .normalize("NFKC")
    .toLocaleLowerCase("vi-VN")
    .replace(/\s*(?:₫|đ|vnd)\s*$/u, "")
    .trim();
  const unit = normalized.match(
    /(triệu|trieu|nghìn|nghin|ngàn|ngan|k|m)\s*$/u,
  )?.[1];
  const numberToken = normalized.match(/\d[\d.,]*/u)?.[0];
  if (!numberToken) return null;

  let numeric: number;
  if (unit) {
    // Có đơn vị thì dấu phẩy/chấm cuối thường là phần thập phân: 1,5 triệu.
    const separators = [...numberToken.matchAll(/[.,]/g)];
    if (separators.length <= 1) numeric = Number(numberToken.replace(",", "."));
    else {
      const last = Math.max(
        numberToken.lastIndexOf("."),
        numberToken.lastIndexOf(","),
      );
      const integer = numberToken.slice(0, last).replace(/[.,]/g, "");
      const decimal = numberToken.slice(last + 1);
      numeric = Number(`${integer}.${decimal}`);
    }
  } else if (/^\d{1,3}(?:[.,]\d{3})+$/u.test(numberToken)) {
    numeric = Number(numberToken.replace(/[.,]/g, ""));
  } else {
    numeric = Number(numberToken.replace(",", "."));
  }

  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const multiplier = /^(?:triệu|trieu|m)$/u.test(unit ?? "")
    ? 1_000_000
    : /^(?:k|nghìn|nghin|ngàn|ngan)$/u.test(unit ?? "")
      ? 1_000
      : 1;
  return Math.round(numeric * multiplier);
}

function cleanSemanticQuery(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/gu, "")
    .trim();
}

export function parsePriceConstraint(query: string): PriceConstraint {
  let working = query.normalize("NFKC").toLocaleLowerCase("vi-VN");
  let minPrice: number | null = null;
  let maxPrice: number | null = null;

  const range = new RegExp(
    String.raw`(?:giá|gia)?\s*(?:từ|tu)\s+${AMOUNT}\s*(?:đến|den|tới|toi|-)\s*${AMOUNT}`,
    "giu",
  );
  working = working.replace(range, (_match, lower: string, upper: string) => {
    const min = parsePriceAmount(lower);
    const max = parsePriceAmount(upper);
    if (min !== null)
      minPrice = minPrice === null ? min : Math.max(minPrice, min);
    if (max !== null)
      maxPrice = maxPrice === null ? max : Math.min(maxPrice, max);
    return " ";
  });

  const upperBound = new RegExp(
    String.raw`(?:giá|gia)?\s*(?:dưới|duoi|tối đa|toi da|không quá|khong qua|<=|<)\s*${AMOUNT}`,
    "giu",
  );
  working = working.replace(upperBound, (_match, raw: string) => {
    const value = parsePriceAmount(raw);
    if (value !== null)
      maxPrice = maxPrice === null ? value : Math.min(maxPrice, value);
    return " ";
  });

  const lowerBound = new RegExp(
    String.raw`(?:giá|gia)?\s*(?:trên|tren|ít nhất|it nhat|từ|tu|>=|>)\s*${AMOUNT}`,
    "giu",
  );
  working = working.replace(lowerBound, (_match, raw: string) => {
    const value = parsePriceAmount(raw);
    if (value !== null)
      minPrice = minPrice === null ? value : Math.max(minPrice, value);
    return " ";
  });

  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    throw new PermanentError(
      `Khoảng giá không hợp lệ: tối thiểu ${minPrice} lớn hơn tối đa ${maxPrice}`,
    );
  }

  return { semanticQuery: cleanSemanticQuery(working), minPrice, maxPrice };
}
