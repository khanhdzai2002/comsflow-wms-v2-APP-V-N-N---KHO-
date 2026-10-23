import { populateCatalogs } from "../src/lib/catalog-setup";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { db } from "../src/lib/db";
const sql = db();
try {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(742917)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`;
    for (const name of (await readdir("migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const source = await readFile(`migrations/${name}`, "utf8"),
        checksum = createHash("sha256").update(source).digest("hex");
      const [existing] =
        await tx`SELECT * FROM schema_migrations WHERE name=${name}`;
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error(`Migration đã thay đổi: ${name}`);
        continue;
      }
      await tx.unsafe(source);
      await tx`INSERT INTO schema_migrations(name,checksum) VALUES(${name},${checksum})`;
      console.log(`Applied ${name}`);
    }
    if (process.env.MIGRATION_SKIP_DEFAULTS === "1") return;
    await populateCatalogs(tx);
  });
  console.log("Database migrations OK");
} finally {
  await sql.end();
}
