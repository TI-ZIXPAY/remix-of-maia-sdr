ALTER TABLE pipeline_stages 
ADD COLUMN webhook_endpoint_id uuid REFERENCES webhook_endpoints(id) ON DELETE SET NULL;