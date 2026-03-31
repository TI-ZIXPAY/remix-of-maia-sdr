ALTER TABLE webhook_endpoints 
ADD COLUMN payload_template JSONB DEFAULT NULL;