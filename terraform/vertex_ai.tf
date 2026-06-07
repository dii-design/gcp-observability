# ==============================================================================
# Vertex AI ML Model Endpoints & Graph Relational Storage for GNN Topology Map
# ==============================================================================

# Deploy Vertex AI Model Endpoint for Graph Neural Network
resource "google_vertex_ai_endpoint" "gnn_endpoint" {
  project      = var.project_id
  name         = "gnn-cascade-predictor"
  display_name = "GNN Anomaly Cascade Predictor Endpoint"
  location     = var.region

  labels = {
    env  = "demo"
    iac  = "terraform"
    model = "pyg-gcn"
  }
}

# BigQuery Table for Graph Nodes
resource "google_bigquery_table" "graph_nodes" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.telemetry_dataset.dataset_id
  table_id   = "graph_nodes"
  schema     = <<EOF
[
  {"name": "node_id", "type": "STRING", "mode": "REQUIRED", "description": "Unique identifier for the microservice node"},
  {"name": "node_name", "type": "STRING", "mode": "REQUIRED", "description": "Human-readable name of the microservice"},
  {"name": "service_type", "type": "STRING", "mode": "NULLABLE", "description": "Category of the service (ingress, database, API etc.)"},
  {"name": "cpu_util", "type": "FLOAT", "mode": "NULLABLE", "description": "Average CPU utilization value"},
  {"name": "mem_util", "type": "FLOAT", "mode": "NULLABLE", "description": "Average memory utilization value"}
]
EOF

  deletion_protection = false
}

# BigQuery Table for Graph Edges (Dependency Links)
resource "google_bigquery_table" "graph_edges" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.telemetry_dataset.dataset_id
  table_id   = "graph_edges"
  schema     = <<EOF
[
  {"name": "edge_id", "type": "STRING", "mode": "REQUIRED", "description": "Unique identifier for the dependency edge"},
  {"name": "source_id", "type": "STRING", "mode": "REQUIRED", "description": "Source node_id representing the dependent component"},
  {"name": "destination_id", "type": "STRING", "mode": "REQUIRED", "description": "Destination node_id representing the parent dependency component"},
  {"name": "dependency_type", "type": "STRING", "mode": "NULLABLE", "description": "Type of linkage (HTTP, GRPC, SQL, TCP)"}
]
EOF

  deletion_protection = false
}
