-- Preserve the distinction between repeated labels and product continuation pages.
-- Historical sources retain their original counts; this applies to new imports.
ALTER TABLE source_manifests
  ADD COLUMN continuation_pages integer NOT NULL DEFAULT 0
  CHECK (continuation_pages >= 0);
