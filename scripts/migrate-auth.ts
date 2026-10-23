import { db } from "../src/lib/db";
import { supabase } from "../src/lib/supabase";
const sql = db();
const apply = process.argv.includes("--apply");
try {
  const users =
    await sql`SELECT id,email,name,role,password_hash FROM users WHERE auth_user_id IS NULL ORDER BY id`;
  console.log("Tài khoản cần liên kết Supabase Auth:", users.length);
  if (!apply) {
    console.log(
      "PLAN ONLY. Dùng --apply sau khi đối soát dữ liệu và cấu hình đúng project Supabase mới.",
    );
  } else
    for (const user of users) {
      if (!/^\$2[aby]\$/.test(user.password_hash))
        throw new Error(
          "Tài khoản " +
            user.id +
            " không có bcrypt hash hợp lệ. Cần đặt mật khẩu qua kênh riêng.",
        );
      const auth = supabase(true).auth.admin;
      const existing = await auth.getUserById(user.id);
      if (
        existing.data.user &&
        existing.data.user.email?.toLowerCase() !== user.email.toLowerCase()
      )
        throw new Error("Auth UUID trùng tài khoản khác; dừng để kiểm tra.");
      if (!existing.data.user) {
        const created = await auth.createUser({
          id: user.id,
          email: user.email,
          password_hash: user.password_hash,
          email_confirm: true,
          user_metadata: { name: user.name },
          app_metadata: { comsflow_provisioned: true, app_role: user.role },
        });
        if (created.error)
          throw new Error(
            "Chưa chuyển được Auth cho UUID " +
              user.id +
              ". Có thể chạy lại an toàn; kiểm tra Supabase Auth.",
          );
      }
      await sql`UPDATE users SET auth_user_id=${user.id} WHERE id=${user.id} AND auth_user_id IS NULL`;
      console.log("Auth linked:", user.id);
    }
} finally {
  await sql.end({ timeout: 5 });
}
