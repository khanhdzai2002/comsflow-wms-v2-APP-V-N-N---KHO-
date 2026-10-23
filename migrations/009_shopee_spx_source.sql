INSERT INTO sales_channels(name) VALUES ('Shopee') ON CONFLICT(name) DO NOTHING;
INSERT INTO shipping_carriers(name) VALUES ('SPX Express') ON CONFLICT(name) DO NOTHING;
-- A hint for unknown scans only. A prefix never substitutes for imported data.
-- Keep any rule already configured by the administrator.
INSERT INTO carrier_matching_rules(prefix,carrier_id,channel_id)
SELECT 'SPXVN',c.id,s.id FROM shipping_carriers c,sales_channels s
WHERE c.name='SPX Express' AND s.name='Shopee'
ON CONFLICT(prefix) DO NOTHING;
