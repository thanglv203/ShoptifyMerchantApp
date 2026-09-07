

export type SampleOptionValue = { optionName: string; name: string };
export type SampleVariant = {
  optionValues: SampleOptionValue[];
  price: number; // đơn vị tiền của store (thiết kế cho VND)
  sku: string;
};
export type SampleProduct = {
  title: string;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string;
  tags: string[];
  status: "ACTIVE" | "DRAFT";
  productOptions: { name: string; position: number; values: { name: string }[] }[];
  variants: SampleVariant[];
};

type Category = {
  type: string; // productType
  base: string; // đầu tiêu đề
  genders: string[]; // nam | nữ | unisex
  styles: string[];
  material: string[];
  priceMin: number;
  priceMax: number;
  sizes: string[];
};

const CATEGORIES: Category[] = [
  {
    type: "Áo thun",
    base: "Áo thun",
    genders: ["nam", "nữ", "unisex"],
    styles: ["cổ tròn basic", "cổ tim", "oversize", "form fitted", "tay lỡ", "in họa tiết"],
    material: ["cotton 100%", "cotton co giãn 4 chiều", "modal mềm mát"],
    priceMin: 129000,
    priceMax: 349000,
    sizes: ["S", "M", "L", "XL"],
  },
  {
    type: "Áo sơ mi",
    base: "Áo sơ mi",
    genders: ["nam", "nữ"],
    styles: ["tay dài công sở", "tay ngắn", "linen mùa hè", "kẻ sọc", "oxford"],
    material: ["linen", "cotton oxford", "lụa tổng hợp"],
    priceMin: 299000,
    priceMax: 690000,
    sizes: ["S", "M", "L", "XL"],
  },
  {
    type: "Áo khoác",
    base: "Áo khoác",
    genders: ["nam", "nữ", "unisex"],
    styles: ["bomber", "gió chống nước", "hoodie nỉ", "dù 2 lớp", "jean denim", "blazer"],
    material: ["nỉ bông dày dặn", "vải dù chống nước", "denim"],
    priceMin: 450000,
    priceMax: 1590000,
    sizes: ["M", "L", "XL"],
  },
  {
    type: "Quần jean",
    base: "Quần jean",
    genders: ["nam", "nữ"],
    styles: ["slim fit", "ống rộng", "ống đứng", "rách gối", "lưng cao"],
    material: ["denim co giãn", "denim dày"],
    priceMin: 349000,
    priceMax: 790000,
    sizes: ["28", "29", "30", "31", "32"],
  },
  {
    type: "Quần short",
    base: "Quần short",
    genders: ["nam", "nữ", "unisex"],
    styles: ["thể thao", "kaki", "jean", "gió chạy bộ"],
    material: ["kaki", "polyester thoáng khí"],
    priceMin: 149000,
    priceMax: 399000,
    sizes: ["S", "M", "L", "XL"],
  },
  {
    type: "Váy",
    base: "Váy",
    genders: ["nữ"],
    styles: ["midi hoa nhí", "chữ A", "bút chì công sở", "maxi đi biển", "xếp ly"],
    material: ["voan", "lụa", "tuytsi"],
    priceMin: 299000,
    priceMax: 890000,
    sizes: ["S", "M", "L"],
  },
  {
    type: "Giày thể thao",
    base: "Giày thể thao",
    genders: ["nam", "nữ", "unisex"],
    styles: ["chạy bộ", "sneaker cổ thấp", "tập gym", "đi bộ đệm khí"],
    material: ["vải mesh thoáng khí", "da tổng hợp"],
    priceMin: 590000,
    priceMax: 2490000,
    sizes: ["39", "40", "41", "42", "43"],
  },
  {
    type: "Giày da",
    base: "Giày da",
    genders: ["nam"],
    styles: ["oxford công sở", "loafer", "derby", "boot cổ ngắn"],
    material: ["da bò thật", "da lộn"],
    priceMin: 890000,
    priceMax: 3200000,
    sizes: ["39", "40", "41", "42"],
  },
  {
    type: "Túi xách",
    base: "Túi",
    genders: ["nữ", "unisex"],
    styles: ["tote canvas", "đeo chéo mini", "xách tay công sở", "bucket"],
    material: ["canvas", "da PU", "da thật"],
    priceMin: 199000,
    priceMax: 1890000,
    sizes: ["One size"],
  },
  {
    type: "Phụ kiện",
    base: "Mũ",
    genders: ["unisex"],
    styles: ["lưỡi trai", "bucket", "len mùa đông", "snapback"],
    material: ["cotton", "len"],
    priceMin: 79000,
    priceMax: 259000,
    sizes: ["One size"],
  },
];

const COLORS = ["Đen", "Trắng", "Xanh navy", "Be", "Xám", "Đỏ đô", "Xanh rêu", "Hồng pastel"];
const VENDORS = ["Coolmate", "Routine", "Canifa", "Yody", "Local Brand SG", "Uniqlo VN", "Aristino"];


function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: () => number, arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)]!;
}

function pickMany<T>(rnd: () => number, arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length > 0) {
    out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]!);
  }
  return out;
}


function roundPrice(rnd: () => number, min: number, max: number): number {
  const raw = min + rnd() * (max - min);
  return Math.max(1000, Math.round(raw / 1000) * 1000 - 1000);
}

function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function slug(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function generateSampleProducts(count: number, seed = 42): SampleProduct[] {
  const rnd = mulberry32(seed);
  const products: SampleProduct[] = [];

  for (let i = 1; i <= count; i++) {
    const cat = CATEGORIES[(i - 1) % CATEGORIES.length]!;
    const gender = pick(rnd, cat.genders);
    const style = pick(rnd, cat.styles);
    const material = pick(rnd, cat.material);
    const colors = pickMany(rnd, COLORS, 1 + Math.floor(rnd() * 3)); // 1–3 màu
    const sizes = pickMany(rnd, cat.sizes, Math.min(cat.sizes.length, 2 + Math.floor(rnd() * 3)));

    const title = `${cat.base} ${gender} ${style} ${colors[0]!.toLowerCase()}`.replace(/\s+/g, " ");
    const vendor = i % 29 === 0 ? null : pick(rnd, VENDORS);

    const descriptionHtml =
      i % 17 === 0
        ? null
        : `<p><strong>${title}</strong> chất liệu ${material}, phù hợp ${
            gender === "unisex" ? "cả nam và nữ" : `phái ${gender}`
          }.</p><p>Thiết kế ${style}, dễ phối đồ đi làm, đi chơi. Màu sắc: ${colors.join(", ")}.</p><ul><li>Bảo hành đường may 6 tháng</li><li>Đổi size trong 7 ngày</li></ul>`;

    const tags =
      i % 23 === 0
        ? []
        : Array.from(
            new Set([
              `${cat.base.toLowerCase()} ${gender}`,
              cat.type.toLowerCase(),
              ...colors.map((c) => `màu ${c.toLowerCase()}`),
              material.split(" ")[0]!.toLowerCase(),
              style.split(" ")[0]!.toLowerCase(),
            ]),
          );

    const basePrice = roundPrice(rnd, cat.priceMin, cat.priceMax);
    const skuBase = slug(`${cat.type}-${i}`).toUpperCase();

    let productOptions: SampleProduct["productOptions"];
    let variants: SampleVariant[];

    if (i % 19 === 0) {
      // Product chỉ có 1 variant mặc định (Shopify biểu diễn bằng option "Title" / "Default Title")
      productOptions = [{ name: "Title", position: 1, values: [{ name: "Default Title" }] }];
      variants = [
        {
          optionValues: [{ optionName: "Title", name: "Default Title" }],
          price: basePrice,
          sku: `${skuBase}-DEFAULT`,
        },
      ];
    } else {
      productOptions = [
        { name: "Màu sắc", position: 1, values: colors.map((c) => ({ name: c })) },
        { name: "Kích cỡ", position: 2, values: sizes.map((s) => ({ name: s })) },
      ];
      variants = [];
      for (const color of colors) {
        for (const size of sizes) {
          // size lớn hơn nhỉnh giá vài nghìn để có min/max price khác nhau
          const bump = sizes.indexOf(size) * 10000;
          variants.push({
            optionValues: [
              { optionName: "Màu sắc", name: color },
              { optionName: "Kích cỡ", name: size },
            ],
            price: basePrice + bump,
            sku: `${skuBase}-${slug(color).toUpperCase()}-${slug(size).toUpperCase()}`,
          });
        }
      }
    }

    products.push({
      title,
      descriptionHtml,
      vendor,
      productType: cat.type,
      tags,
      status: i % 31 === 0 ? "DRAFT" : "ACTIVE",
      productOptions,
      variants,
    });
  }

  return products;
}
