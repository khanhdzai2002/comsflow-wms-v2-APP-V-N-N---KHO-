ALTER TABLE data_jobs ADD COLUMN storage_cleaned_at timestamptz;
CREATE INDEX data_jobs_cleanup ON data_jobs(expires_at) WHERE storage_cleaned_at IS NULL;
