# BigQuery Dataset to receive Cloud Monitoring BigQuery Export metrics
# Note: Google Cloud Monitoring allows continuous streaming of metrics to BigQuery
# via Console settings: Monitoring > Settings > BigQuery Export.
resource "google_bigquery_dataset" "metrics_export" {
  project                    = var.project_id
  dataset_id                 = var.metrics_export_dataset_id
  location                   = var.region
  description                = "Target dataset for continuous export of Cloud Monitoring & Prometheus metrics"
  delete_contents_on_destroy = false
}
