# Deploy Vertex AI Model Endpoint for Graph Neural Network
resource "google_vertex_ai_endpoint" "gnn_endpoint" {
  project      = var.project_id
  name         = "gnn-cascade-predictor"
  display_name = "GNN Anomaly Cascade Predictor Endpoint"
  location     = var.region

  labels = {
    env   = "production"
    iac   = "terraform"
    model = "pyg-gcn"
  }
}
