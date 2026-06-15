variable "project_id" {
  type        = string
  description = "The GCP Project ID to deploy resources into."
}

variable "region" {
  type        = string
  description = "The GCP region to deploy regional resources (e.g., BigQuery datasets)."
  default     = "us-central1"
}

variable "bucket_id" {
  type        = string
  description = "The ID of the Cloud Logging bucket to enable Log Analytics on."
  default     = "_Default"
}

variable "dataset_id" {
  type        = string
  description = "The ID of the BigQuery dataset to hold anomaly detection models and forecasts."
  default     = "telemetry_anomaly_forecasts"
}
