import { createAccount } from "../src/lib/auth";
import { db } from "../src/lib/db";
try {
  const email = process.env.ADMIN_EMAIL,
    password = process.env.ADMIN_PASSWORD,
    name = process.env.ADMIN_NAME || "Quản trị viên";
  if (!email?.includes("@") || !password || password.length < 12)
    throw new Error(
      "Cần ADMIN_EMAIL và ADMIN_PASSWORD >=12 ký tự qua môi trường an toàn",
    );
  const user = await createAccount({ email, password, name, role: "admin" });
  console.log("Đã tạo quản trị viên:", user.id);
} finally {
  await db().end({ timeout: 5 });
}
