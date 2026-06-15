# Production GCP Observability Pipeline: BigQuery ML & GraphML

This directory contains a production-grade infrastructure blueprint and ML pipeline designed to implement **SQL-driven Anomaly Forecasting** and **Topological Graph Neural Network (GNN) Cascade Prediction** on real Google Cloud Platform (GCP) environments.

This pipeline is optimized for organizations that already process terabytes of application logs and metrics and want to automate:
1. **Incident Forecasting:** Predict incident and error volume peaks up to 14 days in advance using BigQuery ML ARIMA+ models.
2. **Anomaly Detection:** Identify statistical outliers in application log patterns and Prometheus time-series metrics.
3. **Cascading Failure Forecasting:** Model the logical/physical dependencies of your applications and use a Graph Neural Network (GNN) to forecast cascade failure risks before upstream services experience outages.

---

## 🏗️ Production Architecture

This pipeline runs entirely serverless and integrates natively with Google Cloud telemetry sinks:

```
                            [ GCP Application Workloads ]
                             /                         \
         (Application Logs / Traces)              (Prometheus Metrics)
                           /                             \
                          ▼                               ▼
                  [ Cloud Logging ]               [ Cloud Monitoring ]
                          │                               │
            (Upgrade to Log Analytics)         (BigQuery Metric Export)
                          │                               │
                          ▼                               ▼
                 [ BigQuery Log Dataset ]      [ BigQuery Metric Table ]
                          │                               │
                          +---------------+---------------+
                                          │
                                          ▼
                         [ BigQuery ML (ARIMA_PLUS) ]
                                          │
                         [ GNN Dependency Extractor ]
                                          │
                                          ▼
                            [ Vertex AI Endpoint (GNN) ]
```

1. **Log Ingestion (Log Analytics):** Application logs are stored in Cloud Logging. By upgrading the log bucket (e.g. `_Default` or a custom bucket) to **Log Analytics**, Google Cloud automatically creates a linked BigQuery dataset, allowing logs to be queried with standard SQL.
2. **Metric Ingestion (Cloud Monitoring BQ Export):** Continuous metrics, including Prometheus time-series scraped by Google Cloud Managed Service for Prometheus (GMP), are exported in real-time to BigQuery using the native Cloud Monitoring BigQuery Export feature.
3. **BigQuery ML:** ARIMA+ time-series models are trained natively inside BigQuery to forecast incident counts and detect metric outliers.
4. **Vertex AI & GraphML (GNN):** 
   - A topology extraction script queries BigQuery to map service dependencies based on span traces (logs) or Prometheus service mesh connections (metrics).
   - A PyTorch Geometric GNN models dependency relationships and predicts failure cascade risk based on live CPU, Memory, and Error Rates.
   - The model is hosted on a Vertex AI custom container endpoint for real-time predictions.

---

## 🛠️ Step-by-Step Setup Guide

### 1. Provision Infrastructure via Terraform
Navigate to the `terraform/` directory to configure and deploy the resources:

```bash
cd terraform/
# Initialize Terraform
terraform init

# Generate plan (provide your actual project_id and variables)
terraform plan -var="project_id=YOUR_PROJECT_ID" -var="existing_log_bucket_name=_Default"

# Apply the configuration
terraform apply -var="project_id=YOUR_PROJECT_ID" -var="existing_log_bucket_name=_Default" -auto-approve
```

### 2. Run BigQuery ML Analytics
Terraform automatically creates datasets and views. You can run these queries directly in BigQuery:

#### A. Forecast Future Application Error Volumes
```sql
SELECT 
  forecast_time, 
  forecast_value,
  prediction_interval_lower_bound,
  prediction_interval_upper_bound
FROM ML.FORECAST(
  MODEL `YOUR_PROJECT_ID.observability_ml.app_error_forecast_model`,
  STRUCT(14 AS horizon, 0.95 AS confidence_level)
)
ORDER BY forecast_time ASC;
```

#### B. Detect Anomalies in Log Metrics
```sql
SELECT * FROM ML.DETECT_ANOMALIES(
  MODEL `YOUR_PROJECT_ID.observability_ml.app_error_forecast_model`,
  STRUCT(0.99 AS anomaly_prob_threshold)
)
WHERE is_anomaly = TRUE
ORDER BY timestamp DESC;
```

### 3. Deploy the Graph Neural Network (GNN) Cascade Predictor
The GraphML component maps application topology and runs GCN (Graph Convolutional Network) convolutions over caller-callee relationships:

```bash
# 1. Setup python virtual environment
cd ../scripts/
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. Extract topology from live BigQuery logs & metrics
# This queries actual trace fields/Prometheus labels and populates BigQuery graph tables
python extract_topology.py --project_id YOUR_PROJECT_ID

# 3. Train the GNN model using live telemetry features and the extracted graph
python train_gnn.py --project_id YOUR_PROJECT_ID

# 4. Build, push, and deploy the GNN to Vertex AI
# This registers the model in Vertex Model Registry and deploys it to the Terraform-created Endpoint
python deploy_gnn.py --project_id YOUR_PROJECT_ID
```

---

## 📂 Directory Structure

- `terraform/`: Contains all HCL declarations for Log Analytics, BigQuery ML datasets, views, and Vertex AI Endpoints.
- `scripts/`:
  - `extract_topology.py`: Dynamically builds topology nodes and edges by querying active traces and metrics.
  - `train_gnn.py`: Fetches telemetry features, trains the PyTorch GNN, and saves model weights.
  - `serve_gnn.py`: FastAPI server compatible with Vertex AI custom container serving.
  - `deploy_gnn.py`: Orchestrates container builds and registration to Vertex AI.
  - `Dockerfile`: Packaging for the FastAPI serving container.
  - `requirements.txt`: Python package requirements.
