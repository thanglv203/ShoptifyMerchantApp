
import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level,
  redact: {
    paths: [
      "accessToken",
      "*.accessToken",
      "refreshToken",
      "*.refreshToken",
      "apiSecret",
      "*.apiSecret",
      "SHOPIFY_API_SECRET",
      "req.headers.authorization",
      "headers['x-shopify-access-token']",
    ],
    censor: "[REDACTED]",
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }),
});

export type Logger = typeof logger;
