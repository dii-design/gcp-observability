# Enable Log Analytics on the Log Bucket (e.g. _Default)
# Note: Log Analytics is a permanent, irreversible upgrade on a logging bucket.
resource "google_logging_project_bucket_config" "analytics_bucket" {
  project          = var.project_id
  location         = "global"
  bucket_id        = var.existing_log_bucket_name
  enable_analytics = true
}

# Create a Log-Based Metric to count application warnings and errors.
# This metric acts as an immediate counter for alerting.
resource "google_logging_metric" "app_errors" {
  project = var.project_id
  name    = "app_error_count"
  filter  = "severity >= WARNING AND resource.type=\"k8s_container\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"

    labels {
      key         = "service"
      value_type  = "STRING"
      description = "The name of the container/service producing the log."
    }
  }

  label_extractors = {
    "service" = "EXTRACT(resource.labels.container_name)"
  }
}
