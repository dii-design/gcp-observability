variable "project_id" {
  type        = string
  description = "The GCP Project ID where resources exist and will be deployed."
}

variable "region" {
  type        = string
  description = "The GCP region to deploy regional resources (e.g. BigQuery datasets, Vertex AI endpoints)."
  default     = "us-central1"
}

variable "existing_log_bucket_name" {
  type        = string
  description = "The name of the existing Cloud Logging bucket to upgrade to Log Analytics."
  default     = "_Default"
}

variable "dataset_id" {
  type        = string
  description = "The ID of the BigQuery dataset to hold anomaly detection models, views, and GNN topology tables."
  default     = "observability_ml"
}

variable "metrics_export_dataset_id" {
  type        = string
  description = "The BigQuery dataset containing the Cloud Monitoring continuous metric export."
  default     = "monitoring_export"
}
