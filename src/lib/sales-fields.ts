import { z } from "zod";
export const salesFields: Record<string, string> = {
  order: "Order ID",
  line: "Order Line ID",
  sku: "SKU ID",
  product: "Seller SKU",
  quantity: "Quantity",
  sold: "Created Time",
  status: "Order Status",
  color: "Color",
  size: "Size",
};
export const salesContextSchema = z.object({
  channel: z.enum(["TikTok Shop", "Shopee"]),
  shop: z.string().trim().min(1).max(100),
  completedStatuses: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
});
