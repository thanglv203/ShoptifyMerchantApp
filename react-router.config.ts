import type { Config } from "@react-router/dev/config";

export default {
  // Embedded app chạy sau tunnel HTTPS của Shopify CLI; proxy nội bộ forward về
  // Vite dev server bằng HTTP → header Origin (https://<tunnel>) khác origin của
  // request.url (http://<tunnel>) → CSRF check của React Router trả 400 "Bad Request"
  // cho MỌI action (POST). Whitelist các host hợp lệ để action chạy được.
  allowedActionOrigins: [
    "*.trycloudflare.com", // tunnel Cloudflare của `shopify app dev` (đổi mỗi lần chạy)
    "*.ngrok-free.app",    // nếu dùng --tunnel-url với ngrok
    "admin.shopify.com",
  ],
} satisfies Config;