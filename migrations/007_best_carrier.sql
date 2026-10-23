INSERT INTO shipping_carriers(name) VALUES ('BEST Express') ON CONFLICT(name) DO NOTHING;
