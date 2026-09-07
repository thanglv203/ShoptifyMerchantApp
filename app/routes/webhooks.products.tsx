import type { ActionFunctionArgs } from "react-router";
import { logger } from "../lib/logger.server";
import { handleProductWebhook } from "../services/webhook-handler.service";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id");
  const eventId = request.headers.get("x-shopify-event-id");

  if (!webhookId) {
    logger.error(
      { shop, topic },
      "webhook hợp lệ nhưng thiếu X-Shopify-Webhook-Id",
    );
    return new Response("Missing webhook id", { status: 400 });
  }

  const result = await handleProductWebhook({
    webhookId,
    eventId,
    topic,
    shopDomain: shop,
    payload,
  });

  return new Response(null, { status: result.retry ? 500 : 200 });
};
