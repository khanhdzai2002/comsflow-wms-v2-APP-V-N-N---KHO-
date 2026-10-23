-- Verified reason labels in the supplied original TikTok return export.
-- Keep any administrator override/disabled rule intact.
INSERT INTO return_reason_rules(phrase,group_key) VALUES
 ('item too big or too small','size'),
 ('ordered wrong size','size'),
 ('poor quality','quality'),
 ('product doesn''t match description','description'),
 ('wrong product sent','wrong')
ON CONFLICT(phrase) DO NOTHING;
