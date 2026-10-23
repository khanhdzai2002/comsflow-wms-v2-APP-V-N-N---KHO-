import { supabase } from "../src/lib/supabase";
const name = process.env.STORAGE_BUCKET || "comsflow-private";
const client = supabase(true).storage;
const options = {
  public: false,
  fileSizeLimit: 50 * 1024 * 1024,
  allowedMimeTypes: [
    "application/pdf",
    "application/octet-stream",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
};
const existing = await client.getBucket(name);
const result = existing.data
  ? await client.updateBucket(name, options)
  : await client.createBucket(name, options);
if (result.error)
  throw new Error(
    "Không cấu hình được bucket riêng tư. Kiểm tra project và quyền service role.",
  );
console.log("Private bucket ready:", name);
