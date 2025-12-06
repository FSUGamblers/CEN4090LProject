-- Set default category for existing cost records
UPDATE cost_records
SET category = 'api'
WHERE category IS NULL;
