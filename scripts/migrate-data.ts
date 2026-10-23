import postgres from "postgres";
import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
const sourceUrl = process.env.SOURCE_DATABASE_URL,
  targetUrl = process.env.DATABASE_URL;
if (!sourceUrl || !targetUrl)
  throw new Error(
    "Cần SOURCE_DATABASE_URL (nguồn cũ) và DATABASE_URL (đích mới) qua môi trường an toàn",
  );
const a = new URL(sourceUrl),
  b = new URL(targetUrl);
if (a.host + a.pathname === b.host + b.pathname)
  throw new Error("Nguồn và đích phải khác database");
const apply = process.argv.includes("--apply");
if (apply && process.env.MIGRATION_TARGET_CONFIRM !== b.hostname + b.pathname)
  throw new Error(
    "Chưa xác nhận đúng database đích bằng MIGRATION_TARGET_CONFIRM=hostname/database",
  );
const options = {
  max: 1,
  prepare: false,
  connect_timeout: 15,
  connection: { statement_timeout: 120000 },
};
const source = postgres(sourceUrl, options),
  target = postgres(targetUrl, options);
const ignored = new Set([
  "schema_migrations",
  "sessions",
  "login_attempts",
  "data_jobs",
  "worker_heartbeats",
  "setup_leases",
]);
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
type Spec = {
  name: string;
  columns: string[];
  keys: string[];
  dependencies: string[];
};
function ordered(specs: Spec[]) {
  const result: Spec[] = [],
    pending = [...specs];
  while (pending.length) {
    const index = pending.findIndex((s) =>
      s.dependencies.every(
        (d) =>
          d === s.name ||
          result.some((r) => r.name === d) ||
          !specs.some((r) => r.name === d),
      ),
    );
    if (index < 0)
      throw new Error(
        "Có vòng tham chiếu giữa các bảng. Cần kiểm tra schema trước khi chuyển.",
      );
    result.push(...pending.splice(index, 1));
  }
  return result;
}
function query(spec: Spec) {
  return `SELECT to_jsonb(r)::text AS row FROM (SELECT ${spec.columns.map(quote).join(",")} FROM public.${quote(spec.name)} ORDER BY ${spec.keys.map(quote).join(",")}) r`;
}
const manifest: { table: string; rows: number; sha256: string }[] = [];
try {
  await source.begin(
    "isolation level repeatable read read only",
    async (old) => {
      await old`SET LOCAL timezone='UTC'`;
      const oldTables =
        await old`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`;
      const specs: Spec[] = [];
      for (const { table_name: name } of oldTables) {
        if (ignored.has(name)) continue;
        const columns = (
          await old`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${name} ORDER BY ordinal_position`
        )
          .map((r) => r.column_name)
          .filter((c) => !(name === "users" && c === "auth_user_id"));
        const targetColumns = (
          await target`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${name}`
        ).map((r) => r.column_name);
        if (columns.some((c) => !targetColumns.includes(c)))
          throw new Error(
            "Schema đích thiếu bảng/cột: " +
              name +
              ". Chạy migration hoặc bổ sung bộ chuyển đổi; không bỏ qua dữ liệu.",
          );
        const keys = (
          await old`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=${"public." + name}::regclass AND i.indisprimary ORDER BY a.attnum`
        ).map((r) => r.attname);
        if (!keys.length) throw new Error("Bảng thiếu primary key: " + name);
        const dependencies = (
          await old`SELECT DISTINCT c.relname name FROM pg_constraint k JOIN pg_class c ON c.oid=k.confrelid WHERE k.conrelid=${"public." + name}::regclass AND k.contype='f'`
        ).map((r) => r.name);
        specs.push({ name, columns, keys, dependencies });
      }
      if (!apply) {
        for (const spec of specs) {
          const [row] = await old.unsafe(
            `SELECT count(*)::text n FROM public.${quote(spec.name)}`,
          );
          console.log(`${spec.name}: ${row.n} dòng`);
        }
        console.log("PLAN ONLY: không thay đổi nguồn hoặc đích.");
        return;
      }
      await target.begin("isolation level serializable", async (next) => {
        await next`SELECT pg_advisory_xact_lock(742930)`;
        await next`SET LOCAL timezone='UTC'`;
        const [guard] =
          await next`SELECT EXISTS(SELECT 1 FROM users) OR EXISTS(SELECT 1 FROM orders) OR EXISTS(SELECT 1 FROM scan_events) OR EXISTS(SELECT 1 FROM return_cases) OR EXISTS(SELECT 1 FROM data_jobs) used`;
        if (guard.used)
          throw new Error(
            "Database đích đã có dữ liệu vận hành/tài khoản. Không ghi đè.",
          );
        // Only disposable migration defaults in a verified unused target are cleared.
        // Foreign keys remain enabled throughout the copy.
        const clearing = [
          ...new Set([
            ...specs.map((s) => s.name),
            "sessions",
            "login_attempts",
            "data_jobs",
            "worker_heartbeats",
            "setup_leases",
          ]),
        ];
        await next.unsafe(
          "TRUNCATE " +
            clearing.map((name) => "public." + quote(name)).join(","),
        );
        for (const spec of ordered(specs)) {
          const hash = createHash("sha256");
          let count = 0;
          for await (const batch of old.unsafe(query(spec)).cursor(250)) {
            const raw = batch.map((r) => r.row as string);
            raw.forEach((row) => hash.update(row + "\n"));
            count += raw.length;
            await next.unsafe(
              `INSERT INTO public.${quote(spec.name)} (${spec.columns.map(quote).join(",")}) SELECT ${spec.columns.map(quote).join(",")} FROM jsonb_populate_recordset(NULL::public.${quote(spec.name)},$1::text::jsonb)`,
              ["[" + raw.join(",") + "]"],
            );
          }
          const expected = hash.digest("hex"),
            actual = createHash("sha256");
          let copied = 0;
          for await (const batch of next.unsafe(query(spec)).cursor(250))
            for (const row of batch) {
              actual.update(row.row + "\n");
              copied++;
            }
          if (count !== copied || expected !== actual.digest("hex"))
            throw new Error(
              "Đối soát số dòng/hash không khớp: " +
                spec.name +
                "; toàn bộ chuyển dữ liệu được rollback.",
            );
          manifest.push({ table: spec.name, rows: count, sha256: expected });
          console.log(`${spec.name}: verified ${count} dòng`);
        }
      });
    },
  );
  if (apply) {
    await mkdir("backups", { recursive: true });
    await writeFile(
      "backups/migration-manifest.json",
      JSON.stringify(
        { at: new Date().toISOString(), tables: manifest },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      "Đã chuyển và đối soát đủ bảng. Chưa chuyển đăng nhập; chạy db:migrate-auth tiếp theo. Nguồn cũ không bị sửa.",
    );
  }
} finally {
  await source.end({ timeout: 5 });
  await target.end({ timeout: 5 });
}
