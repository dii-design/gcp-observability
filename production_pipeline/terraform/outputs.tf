output "project_id" {
  value       = var.project_id
  description = "The GCP Project ID."
}

output "region" {
  value       = var.region
  description = "The GCP Region."
}

output "dataset_id" {
  value       = google_bigquery_dataset.observability_dataset.dataset_id
  description = "The BigQuery dataset ID."
}

output "vertex_endpoint_id" {
  value       = google_vertex_ai_endpoint.gnn_endpoint.id
  description = "The Vertex AI Endpoint ID."
}

output "vertex_endpoint_name" {
  value       = google_vertex_ai_endpoint.gnn_endpoint.name
  description = "The Vertex AI Endpoint Resource Name."
}
