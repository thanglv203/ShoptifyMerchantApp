# Shopify Product Vector Search
​
Embedded Shopify app đồng bộ Product từ Shopify Admin GraphQL API về PostgreSQL, duy trì dữ liệu bằng webhook, tạo embedding và tìm kiếm sản phẩm theo ngữ nghĩa bằng pgvector.
​
```text
Shopify → Admin GraphQL API → Product Sync → PostgreSQL → Embedding → Vector Storage → Semantic Search
                ↑ products/create | products/update | products/delete webhooks
```
​
## 1. Installation
​
### Requirements
​
- Node.js `>=22.12`
- npm
- Docker Desktop hoặc Docker Engine + Compose
- Shopify CLI 4.x
- Shopify Partner/Dev Dashboard account
- Development store
​
Cài Shopify CLI nếu chưa có:
​
```bash
npm install -g @shopify/cli@latest
```
​
Kiểm tra môi trường:
​
```bash
node --version
npm --version
shopify version
docker compose version
```
​
### Development local — khuyến nghị
​
Clone và cài dependency:
​
```bash
git clone <YOUR_REPOSITORY_URL>
cd <YOUR_REPOSITORY_DIRECTORY>
npm ci
cp .env.example .env
```
​
​
Khởi động PostgreSQL và chạy migration:
​
```bash
docker compose up -d db
npm run setup
```
​
Cần hai terminal.
​
Terminal 1 — Shopify app:
​
```bash
npm run dev
```
​
Terminal 2 — pg-boss worker:
​
```bash
npm run worker:dev
```
​
Nếu worker chưa chạy, Sync vẫn tạo job trong PostgreSQL nhưng job sẽ chờ và chưa được xử lý.
​
### Production-like bằng Docker Compose
​
Sau khi điền đầy đủ `.env`:
​
```bash
docker compose up --build -d
docker compose ps -a
docker compose logs -f app worker
```
​
Compose chạy theo thứ tự:
​
```text
db healthy → migrate completed → app + worker
```
​
Không chạy thêm `npm run dev` hoặc `npm run worker:dev` khi full Compose đang chạy.
​
Kiểm tra app:
​
```bash
curl http://localhost:3000/healthz
```
​
Dừng nhưng giữ database:
​
```bash
docker compose down
```
​
Chỉ dùng lệnh sau khi muốn xóa toàn bộ Product, vector và jobs:
​
```bash
docker compose down -v
```
​
## 2. Configuration
​
​
### Shopify và database
​
| Biến                 | Bắt buộc | Mặc định/ví dụ                                                                      | Mô tả                                                                   |
| -------------------- | -------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `SHOPIFY_API_KEY`    | Có       | —                                                                                   | Client ID của Shopify app; Shopify CLI có thể inject khi dev            |
| `SHOPIFY_API_SECRET` | Có       | —                                                                                   | Client secret, chỉ dùng server-side                                     |
| `SHOPIFY_APP_URL`    | Có       | URL tunnel hoặc `http://localhost:3000`                                             | Public HTTPS URL khi chạy embedded app; localhost chỉ dùng test Compose |
| `SCOPES`             | Không    | `read_products`                                                                     | Scope tối thiểu để đọc Product và nhận product webhooks                 |
| `DATABASE_URL`       | Có       |                                                                                     | Local dùng `localhost`; Compose tự override hostname thành `db`         |
| `POSTGRES_PORT`      | Không    | `5432`                                                                              | PostgreSQL port expose ra host                                          |
| `APP_PORT`           | Không    | `3000`                                                                              | HTTP app port expose ra host                                            |
| `LOG_LEVEL`          | Không    | `info`                                                                              | `fatal`, `error`, `warn`, `info`, `debug`, `trace`                      |
| `SYNC_PAGE_SIZE`     | Không    | `25`                                                                                | Product mỗi GraphQL page; giữ query cost dưới giới hạn Shopify          |
​
### Embedding
​
| Biến                     | Bắt buộc            | Mặc định/ví dụ             | Mô tả                                                 |
| ------------------------ | ------------------- | -------------------------- | ----------------------------------------------------- |
| `EMBEDDING_PROVIDER`     | Không               | `fake`                     | `fake`, `gemini` hoặc `ollama`                        |
| `EMBEDDING_DIMENSION`    | Không               | `768`                      | Phải khớp cột PostgreSQL `vector(768)`                |
| `EMBEDDING_VERSION`      | Không               | `2`                        | Tăng khi đổi canonical text hoặc thuật toán embedding |
| `EMBEDDING_BATCH_SIZE`   | Không               | `50`                       | Product tối đa trong một embedding batch              |
| `EMBEDDING_CONCURRENCY`  | Không               | `5`                        | Số embedding request đồng thời                        |
| `GEMINI_API_KEY`         | Khi dùng Gemini     | —                          | API key, không commit                                 |
| `GEMINI_EMBEDDING_MODEL` | Không               | `gemini-embedding-001`     | Gemini embedding model                                |
| `OLLAMA_BASE_URL`        | Khi dùng Ollama     | `http://localhost:11434`   | Ollama API URL                                        |
| `OLLAMA_EMBEDDING_MODEL` | Không               | `bge-m3`                   | Ollama embedding model                                |
| `EVAL_SHOP_DOMAIN`       | Khi chạy evaluation | `your-store.myshopify.com` | Shop dùng cho sáu query evaluation                    |
​
### Seed data
​
| Biến                      | Bắt buộc | Mặc định  | Mô tả                                          |
| ------------------------- | -------- | --------- | ---------------------------------------------- |
| `SEED_SHOP_DOMAIN`        | Khi seed | —         | Development store domain                       |
| `SEED_ADMIN_ACCESS_TOKEN` | Khi seed | —         | Token của custom app riêng có `write_products` |
| `SEED_COUNT`              | Không    | `300`     | Số Product mẫu                                 |
| `SEED_API_VERSION`        | Không    | `2026-07` | Shopify Admin API version của seed script      |
​
Cấu hình tối thiểu để reviewer chạy offline:
​
```env
SCOPES=read_products
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shopify_vector_search?schema=public
EMBEDDING_PROVIDER=fake
EMBEDDING_DIMENSION=768
EMBEDDING_VERSION=2
EMBEDDING_BATCH_SIZE=50
EMBEDDING_CONCURRENCY=5
```
​
## 3. Shopify Setup
​
1. Mở Shopify Dev Dashboard và tạo development store.
2. Chạy `shopify app dev` lần đầu.
3. Chọn tạo app mới hoặc link app hiện có.
4. Chọn development store và cài app khi trình duyệt mở.
5. Giữ `client_id` thật trong `shopify.app.toml`.
​
Có thể link lại app bằng:
​
```bash
npm run config:link
```
​
### App configuration

`shopify.app.toml` sử dụng:

```toml
[access_scopes]
scopes = "read_products"

[webhooks]
api_version = "2026-07"

[[webhooks.subscriptions]]
topics = ["products/create", "products/update", "products/delete"]
uri = "/webhooks/products"
```

`ApiVersion.July26` trong `app/shopify.server.ts` phải khớp `api_version = "2026-07"`.

### Vì sao chỉ dùng `read_products`?

Ứng dụng hiện chỉ đọc Product từ Shopify và lưu vào database riêng. Scope này đủ cho:

- Product và ProductVariant
- Product media
- Product webhook subscriptions

App không cập nhật Product lên Shopify nên không cần `write_products`. Không sử dụng order/customer nên không xin `read_orders` hoặc `read_customers`.

### Seed catalog lớn

App chính chỉ có `read_products`, vì vậy seed script cần token của **custom app riêng** trong development store:

1. Shopify Admin → Settings → Apps and sales channels.
2. Develop apps → Create an app.
3. Cấp `write_products`.
4. Install app và lấy Admin API access token.
5. Điền `SEED_SHOP_DOMAIN` và `SEED_ADMIN_ACCESS_TOKEN` vào `.env`.

Xem trước dữ liệu:

```bash
npm run seed:dry
```

Tạo product:

```bash
npm run seed
```
​
## 4. Database
​
Project dùng PostgreSQL 17 và extension pgvector qua Docker image:
​
```text
pgvector/pgvector:pg17
```
​
Khởi động PostgreSQL + pgvector:

```bash
docker compose up -d db
docker compose ps
docker compose logs -f db
```

Docker image:

```text
pgvector/pgvector:pg17
```

Prisma 6 quản lý relational schema. Migration đầu tiên bật pgvector trước khi tạo cột vector:
​
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```
​
| Model              | Mục đích                         | Ràng buộc chính                    |
| ------------------ | -------------------------------- | ---------------------------------- |
| `Session`          | Shopify session/offline token    | Shopify session storage quản lý    |
| `Shop`             | Tenant của app                   | `domain @unique`                   |
| `Product`          | Bản sao Shopify Product          | `@@unique([shopId, shopifyId])`    |
| `Variant`          | Product variants                 | `@@unique([productId, shopifyId])` |
| `ProductEmbedding` | Vector và embedding metadata     | `productId @unique`                |
| `SyncJob`          | Tiến độ/checkpoint sync          | `activeLockKey @unique`            |
| `WebhookEvent`     | Audit và delivery dedupe         | `webhookId @unique`                |
​
Các lệnh database:
​
```bash
npm run setup            # prisma generate + migrate deploy
npm run db:migrate       # prisma migrate deploy
npm run db:migrate:dev   # prisma migrate dev
npm run db:studio        # Prisma Studio
npm run db:reset         # xóa toàn bộ dữ liệu, chỉ dùng development
```
​
​
## 5. Embedding
​
Business logic phụ thuộc interface `EmbeddingProvider` thay vì gọi trực tiếp một vendor:
​
```ts
export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly dimension: number;
​
  embed(
    text: string,
    taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  ): Promise<number[]>;
}
```
​
| Provider | Model                  |               Output dùng trong app | Mục đích                                   |
| -------- | ---------------------- | ----------------------------------: | ------------------------------------------ |
| Gemini   | `gemini-embedding-001` |                                 768 | Provider chính                             |
| Fake     | `fake-feature-hash-v2` |                                 768 | Test/dev deterministic và offline          |
| Ollama   | `bge-m3`               | 1024 → lấy 768 chiều đầu, normalize | Fallback local miễn phí                    |
​
Provider được chọn qua `EMBEDDING_PROVIDER` và factory:
​
​
Trước khi embedding, Product được chuyển thành canonical text ổn định gồm title, description, vendor, product type, tags, min price và variants. Inventory bị loại vì thay đổi inventory không làm thay đổi ý nghĩa Product.
​
`dataHash` là SHA-256 của:
​
```text
provider + model + dimension + version + canonical Product text
```
​
Nếu hash không đổi, service trả `HASH_UNCHANGED` và giữ vector cũ. Lifecycle embedding:
​
```text
PENDING → provider.embed() → validate vector[768] → READY
                   └── lỗi → FAILED
```
​
Pg-boss persist `embed-product` và `embed-shop` jobs trong PostgreSQL, có singleton key, retry, exponential backoff và heartbeat.
​
## 6. Vector Search
​
### Cách lưu vector
​
Vector được lưu trong PostgreSQL, bảng `ProductEmbedding`:
​
```prisma
model ProductEmbedding {
  productId  String                      @unique
  embedding  Unsupported("vector(768)")?
  model      String
  dimension  Int
  version    Int
  dataHash   String
  status     EmbeddingStatus
  error      String?
  embeddedAt DateTime?
}
```
​
Prisma không thao tác trực tiếp với `Unsupported("vector(768)")`, vì vậy repository ghi vector bằng parameterized raw SQL. Vector thực tế có dạng:
​
```sql
'[0.0123,-0.0087,0.0412,...]'::vector
```
​
Mỗi vector có đúng 768 số finite. Metadata `model`, `dimension` và `version` được lưu cùng vector để không so sánh hai embedding space không tương thích.
​
### Cách tìm kiếm vector
​
Ví dụ query:
​
```text
áo nam màu đen dưới 500k
```
​
Price Parser tách thành:
​
```ts
{
  semanticQuery: "áo nam màu đen",
  minPrice: null,
  maxPrice: 500000,
}
```
​
`semanticQuery` được embed bằng `RETRIEVAL_QUERY`. Điều kiện giá được áp dụng chính xác bằng SQL.
​
pgvector sử dụng cosine distance:
​
```sql
pe."embedding" <=> query_vector
```
​
Distance càng nhỏ thì càng liên quan. Similarity hiển thị trên UI là:
​
```sql
1 - (pe."embedding" <=> query_vector)
```
​
Search query rút gọn:
​
```sql
SELECT
  p."title",
  p."price",
  1 - (pe."embedding" <=> query_vector) AS similarity
FROM "Product" p
JOIN "ProductEmbedding" pe
  ON pe."productId" = p."id"
WHERE p."shopId" = current_shop
  AND p."deletedAt" IS NULL
  AND pe."status" = 'READY'
  AND pe."model" = current_model
  AND pe."dimension" = 768
  AND pe."version" = current_version
  AND p."price" <= 500000
ORDER BY pe."embedding" <=> query_vector ASC
LIMIT 5;
```
​
Các filter bắt buộc:
​
- Đúng `shopId`, tránh rò dữ liệu giữa các store.
- `deletedAt IS NULL`.
- Embedding `READY` và vector không null.
- Cùng model, dimension và version.
- Min/max price từ Price Parser.
- Giới hạn Top 5.
​
Không thể dùng Gemini query vector để search Product vector của Fake hoặc Ollama. Khi đổi provider phải restart app/worker, enqueue `embed-shop` hoặc Sync Products và chờ toàn bộ embedding chuyển về `READY` với model mới.
​
## 7. Architecture
​
```mermaid
flowchart LR
    S["Shopify Store"] --> A["Admin GraphQL API"]
    A --> SY["Product Sync"]

    WH["Product Webhooks"] --> WS["Webhook Service"]
    SY --> Q["pg-boss"]
    WS --> Q

    Q --> W["Background Worker"]
    W --> DB[("PostgreSQL + pgvector")]

    DB --> E["Embedding Service"]
    E --> P["Fake / Gemini / Ollama"]
    P --> V[("ProductEmbedding vector(768)")]

    U["Search UI"] --> PC["Price Parser"]
    PC --> QE["RETRIEVAL_QUERY Embedding"]
    QE --> VS["pgvector Cosine Search"]

    V --> VS
    DB --> VS
    VS --> R["Top 5 Products"]
```
​
Luồng Product Sync:
​
```text
Shopify Admin API
→ cursor pagination + retry/throttle handling
→ map Product/Variant
→ idempotent database upsert
→ checkpoint SyncJob
→ enqueue embed-shop
→ canonical text + dataHash
→ RETRIEVAL_DOCUMENT embedding
→ ProductEmbedding READY
```
​
Luồng webhook:
​
```text
Shopify products/create|update|delete
→ authenticate.webhook + HMAC verification
→ WebhookEvent insert-first dedupe
→ timestamp guard
→ upsert hoặc soft delete
→ enqueue embed-product khi semantic data thay đổi
```
​
Luồng search:
​
```text
User query
→ parse price constraint
→ RETRIEVAL_QUERY embedding
→ filter shop/deleted/status/model/dimension/version/price
→ pgvector cosine distance
→ Top 5
```
​
Phân lớp source:
​
```text
app/routes/*          HTTP, Shopify authentication, response và UI
app/services/*        Business workflows và pure mapping
app/repositories/*    Prisma, raw SQL và transactions
app/providers/*       Shopify/Gemini/Ollama external I/O
app/jobs/*            pg-boss publisher, consumers và handlers
app/lib/*             Env, errors, logging, hash và formatting
```
​

