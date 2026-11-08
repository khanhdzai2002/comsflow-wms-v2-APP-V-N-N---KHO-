# Danh sách tệp thay đổi

So với bản nền `0fc6fb5`. Tệp mới/được sửa đều phục vụ nâng cấp hàng hoàn, bảo toàn lịch sử hoặc hồi quy. Không thay dependency, binding Hyperdrive, secret runtime, đăng nhập hoặc dữ liệu production. Tóm tắt mục đích từng nhóm ở [README](README.md).

## Migration và quyền

| Tệp                                        | Thay đổi |
| ------------------------------------------ | -------- |
| `migrations/020_return_operations.sql`     | Thêm mới |
| `scripts/build-supabase-sql.mjs`           | Cập nhật |
| `scripts/setup-storage.ts`                 | Cập nhật |
| `scripts/sql/grant-hyperdrive-runtime.sql` | Cập nhật |
| `supabase/bootstrap.sql`                   | Cập nhật |
| `supabase/upgrade-018.sql`                 | Cập nhật |
| `supabase/upgrade-019.sql`                 | Cập nhật |
| `supabase/upgrade-020.sql`                 | Thêm mới |

## Giao diện và tài liệu trong app

| Tệp                                       | Thay đổi |
| ----------------------------------------- | -------- |
| `src/app/globals.css`                     | Cập nhật |
| `src/components/catalog-readiness.tsx`    | Cập nhật |
| `src/components/return-handover.tsx`      | Thêm mới |
| `src/components/return-intake-client.ts`  | Thêm mới |
| `src/components/return-media-client.ts`   | Thêm mới |
| `src/components/return-operations.tsx`    | Thêm mới |
| `src/components/return-report-client.ts`  | Thêm mới |
| `src/components/return-schema-notice.tsx` | Thêm mới |
| `src/components/returns.tsx`              | Cập nhật |
| `src/components/user-guide.tsx`           | Cập nhật |
| `src/components/workspace.tsx`            | Cập nhật |

## Nghiệp vụ và API

| Tệp                                   | Thay đổi |
| ------------------------------------- | -------- |
| `src/lib/app-version.ts`              | Cập nhật |
| `src/lib/jobs.ts`                     | Cập nhật |
| `src/lib/maintenance.ts`              | Cập nhật |
| `src/lib/queries.ts`                  | Cập nhật |
| `src/lib/return-domain.ts`            | Cập nhật |
| `src/lib/return-facts.ts`             | Thêm mới |
| `src/lib/return-identifiers.ts`       | Thêm mới |
| `src/lib/return-import.ts`            | Cập nhật |
| `src/lib/return-intake-fields.ts`     | Thêm mới |
| `src/lib/return-intake-jobs.ts`       | Thêm mới |
| `src/lib/return-intake-normalize.ts`  | Thêm mới |
| `src/lib/return-media.ts`             | Thêm mới |
| `src/lib/return-operation-actions.ts` | Thêm mới |
| `src/lib/return-operation-labels.ts`  | Thêm mới |
| `src/lib/return-operation-query.ts`   | Thêm mới |
| `src/lib/return-operation-sources.ts` | Thêm mới |
| `src/lib/return-operations-access.ts` | Thêm mới |
| `src/lib/return-receipts.ts`          | Thêm mới |
| `src/lib/return-reports.ts`           | Thêm mới |
| `src/lib/return-source-archive.ts`    | Thêm mới |
| `src/lib/returns.ts`                  | Cập nhật |
| `src/lib/stored-file-verification.ts` | Cập nhật |
| `src/server/api.ts`                   | Cập nhật |
| `src/server/return-operation-api.ts`  | Thêm mới |
| `src/server/worker.ts`                | Cập nhật |

## Parser và xử lý tệp

| Tệp                                    | Thay đổi |
| -------------------------------------- | -------- |
| `src/worker/browser-return-intake.ts`  | Thêm mới |
| `src/worker/browser-return-report.ts`  | Thêm mới |
| `src/worker/main.ts`                   | Cập nhật |
| `src/worker/return-report-workbook.ts` | Thêm mới |
| `src/worker/xlsx-raw-table.ts`         | Thêm mới |

## Kiểm thử

| Tệp                                       | Thay đổi |
| ----------------------------------------- | -------- |
| `tests/e2e/platform.spec.ts`              | Cập nhật |
| `tests/maintenance.test.ts`               | Cập nhật |
| `tests/prescan-upgrade.test.ts`           | Cập nhật |
| `tests/return-operation-facts.test.ts`    | Thêm mới |
| `tests/return-operations-upgrade.test.ts` | Thêm mới |
| `tests/return-operations.test.ts`         | Thêm mới |
| `tests/return-report-workbook.test.ts`    | Thêm mới |
| `tests/returns-v2.test.ts`                | Cập nhật |
| `tests/returns.test.ts`                   | Cập nhật |

## Tài liệu bàn giao

| Tệp                                             | Thay đổi |
| ----------------------------------------------- | -------- |
| `docs/returns-v2/ACCEPTANCE.md`                 | Thêm mới |
| `docs/returns-v2/ARCHITECTURE-AND-MIGRATION.md` | Thêm mới |
| `docs/returns-v2/BENCHMARK.json`                | Thêm mới |
| `docs/returns-v2/CHANGED-FILES.md`              | Thêm mới |
| `docs/returns-v2/DEPLOYMENT.md`                 | Thêm mới |
| `docs/returns-v2/OPERATOR-GUIDE.md`             | Thêm mới |
| `docs/returns-v2/README.md`                     | Thêm mới |

## Quy ước và cấu hình build

| Tệp              | Thay đổi |
| ---------------- | -------- |
| `AGENTS.md`      | Cập nhật |
| `vite.config.ts` | Cập nhật |
