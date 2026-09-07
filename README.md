# Shopify Product Vector Search

Shopify App (embedded) đồng bộ product từ Shopify → PostgreSQL, tạo embedding, lưu vector (pgvector) và tìm kiếm sản phẩm theo ngữ nghĩa


```
Shopify → Admin GraphQL API → Product Sync → PostgreSQL → Embedding → Vector Storage (pgvector) → Semantic Search
                ↑ webhooks products/create|update|delete (idempotent)
```

## 1. Installation


```bash
git clone <repo> && cd <repo>
npm install
cp .env.example .env            
docker compose up -d db         # PostgreSQL 17 + pgvector (port 5432)
npm run dev                     # = shopify app dev 
```

Requiremnets:

  - Node.js `>=22.12`
  - npm
  - Docker Desktop hoặc Docker Engine + Compose
  - Shopify CLI 4.x
  - Shopify Partner/Dev Dashboard account
  - Development store

Cài Shopify CLI nếu chưa có:

```bash
npm install -g @shopify/cli@latest
```

Kiểm tra:

```bash
node --version
shopify version
docker compose version
```

## 2. Configuration

| Biến | Bắt buộc | Mặc định | Mô tả |
|---|---|---|---|
| `SHOPIFY_API_KEY` | ✅ | — | Client ID của app (CLI inject khi dev) |
| `SHOPIFY_API_SECRET` | ✅ | — | Client secret |
| `SHOPIFY_APP_URL` | ✅ | — | URL app (tunnel khi dev) |
| `SCOPES` | |  | Scope  |
| `DATABASE_URL` | ✅ |  | PostgreSQL |
| `LOG_LEVEL` | | `info` | pino level |
| `SYNC_PAGE_SIZE` | | `50` |  |
| `SEED_SHOP_DOMAIN`, `SEED_ADMIN_ACCESS_TOKEN`, `SEED_COUNT`, `SEED_API_VERSION` |  |  | |


## 3. Shopify Setup
1. **Dev Dashboard** (dev.shopify.com/dashboard) → tạo development store (tick *Generate test data* nếu muốn có sẵn product).
2. `shopify app dev` lần đầu → chọn *Create as new app* (hoặc link app có sẵn) → chọn store → cài app khi trình duyệt mở.
3. **Access scope**:
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
## 4. Database

PostgreSQL 17 + pgvector (Docker image `pgvector/pgvector:pg17`), truy cập qua Prisma 6.

| Model              | Mục đích                      | Ràng buộc chính                    |
| ------------------ | ----------------------------- | ---------------------------------- |
| `Session`          | Shopify session/offline token | Do Shopify package quản lý         |
| `Shop`             | Tenant của app                | `domain @unique`                   |
| `Product`          | Bản sao Shopify Product       | `@@unique([shopId, shopifyId])`    |
| `Variant`          | Product variants              | `@@unique([productId, shopifyId])` |
| `ProductEmbedding` | Vector và embedding metadata  | `productId @unique`                |
| `SyncJob`          | Tiến độ/checkpoint sync       | `activeLockKey @unique`            |
| `WebhookEvent`     | Delivery audit và dedupe      | `webhookId @unique`                |


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

Migration đầu tiên có:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Các lệnh database:

```bash
npm run db:migrate       # prisma migrate deploy
npm run db:migrate:dev   # prisma migrate dev
npm run db:studio        # Prisma Studio
npm run db:reset         # XÓA toàn bộ dữ liệu, chỉ dùng ở dev
```