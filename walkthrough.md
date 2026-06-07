# Walkthrough: Deployable GCP Telemetry Anomaly Forecasting Suite

We have successfully transitioned the local interactive anomaly forecasting demo into a fully deployable, production-ready GCP Infrastructure-as-Code package using Terraform, completely removing any GSK branding to make the suite fit for any Google Cloud user.

---

## 🌟 Key Achievements

1.  **De-branding & Clean Bundling:**
    *   Removed all references to "GSK" across `index.html`, `styles.css`, `app.js`, `package.json`, and `README.md`.
    *   Updated the script tag in `index.html` to `type="module"` to enable warning-free, standard production bundling via Vite.
    *   Verified that `npm run build` compiles into a highly optimized bundle without warnings.
2.  **Modular, Production-Ready Terraform Suite:**
    *   Created `terraform/variables.tf` to declare project ID, region, bucket ID, and dataset ID configurations.
    *   Created `terraform/main.tf` to set up standard HashiCorp Google provider.
    *   Created `terraform/logging.tf` to provision a Log Analytics-enabled logging bucket and configure a log-based metric (`servicenow_incident_count`) with structured label extraction for country and site labels.
    *   Created `terraform/bigquery.tf` to provision the BigQuery forecasting dataset and execute a BigQuery ML `ARIMA_PLUS` training query job on deployment.
    *   Created `terraform/monitoring.tf` to provision three native Cloud Monitoring alert policies with standard `forecast_options` for Disk, RAM, and CPU capacity metrics.
    *   Created `terraform/dashboard.tf` to define a native, custom GCP Cloud Monitoring Dashboard in JSON format using `jsonencode`, linking CPU, RAM, Disk, and ServiceNow log metrics in a single page.
    *   Created `terraform/outputs.tf` to return project variables, alert IDs, and a direct Google Cloud Console URL for the newly deployed dashboard.
3.  **Comprehensive runbook documentation:**
    *   Rewrote the root `README.md` into an enterprise runbook explaining prerequisites, GCP CLI authentication, `terraform init/plan/apply` commands, custom SQL queries for model predictions in BigQuery ML, and dashboard verification.
4.  **Premium Graph Neural Network (GNN) Enrichment:**
    *   **Interactive HTML5 Canvas Network Visualizer:** Created an interactive, highly responsive 2D Canvas rendering loop within `app.js` that overrides standard `Chart.js` when `gnn_topology` is selected. Features glowing status halos, pulsing microservice connection edges, and flowing data packets that dynamically react to injected anomalies (spikes/drops/drifts).
    - **Cascading Failure Wave Simulation:** Programmed backward-propagating failure waves that ripple upstream from `Payment DB` to `Payment Service` and `API Gateway` during anomaly injections, complete with live glassmorphic HUD overlays reporting cascading risk probability metrics.
    - **GNN MLOps Blueprints:** Injected four native code blueprints in the dashboard's code panel (BigQuery Graph property schema definition, PyTorch Geometric GCN model architecture, PromQL/MQL joint latency correlations, and Vertex AI Terraform resource deployments).
    - **GCP Graph Provisioning (`terraform/vertex_ai.tf`):** Created a dedicated, modular IaC file to provision the `google_vertex_ai_endpoint` named `gnn_endpoint` (`gnn-cascade-predictor` inside `us-central1`) and two `google_bigquery_table` resources for nodes (`graph_nodes`) and edges (`graph_edges`) inside the `telemetry_anomaly_forecasts` dataset.
5.  **BigQuery ML ARIMA+ Diagnostics (O'Reilly BQML ARIMA Integration):**
    *   **Dashboard Blueprints Enriched:** Injected advanced diagnostic SQL queries inside `app.js` under the `servicenow_country` and `servicenow_location` logging keys.
    *   **Candidate Model Evaluation (`ML.ARIMA_EVALUATE`):** Added capability to evaluate different statistical orders (p, d, q) and check AIC/BIC metrics.
    *   **Seasonal Component Decomposition (`ML.EXPLAIN_FORECAST`):** Integrated time-series decomposition to isolate trend, holiday, daily, and weekly seasonality components.
    *   **ARIMA Coefficient Analysis (`ML.ARIMA_COEFFICIENTS`):** Added queries to directly fetch auto-regressive and moving-average model parameters to understand statistical weighting.
    *   **Automated Live Database Views:** Configured four managed BigQuery views in `terraform/bigquery.tf` representing the live forecasts, anomalies, evaluations, and coefficients queries. This automates the entire analysis pipeline right upon `terraform apply`.
    *   **Runbook Step 3 Enrichment:** Documented both the queries and the pre-configured views step-by-step in `README.md`.
6.  **Unified Logs & Timeseries Metric Correlation:**
    *   **Interactive Simulation Section Added:** Integrated `logs_metrics_correlation` in the sandbox playground's dataset selection in `app.js` and `index.html`. It provides a dedicated workspace for testing logs-metrics correlation logic.
    *   **BigQuery SQL Joining Template:** Designed a production-grade SQL blueprint illustrating how to align irregular event-driven logs (Log Analytics upgraded `_AllLogs` bucket) with regular interval timeseries metrics (Continuous Cloud Monitoring BigQuery Export) by bucketing timestamps into 5-minute intervals and joining on resource ID keys.
    *   **Joint-Alert & MQL Blueprints:** Provided custom templates for multi-condition GKE alert policies (`AND` combiner) and multi-stream join queries using Monitoring Query Language (MQL) in Monarch.
    *   **Comprehensive Guide Integrated:** Added a detailed architectural breakdown and configuration guide inside `README.md`.

---

## 🔍 Validation & Testing Results

### 1. Terraform Verification (`terraform validate`)
We initialized the terraform directory with `terraform init -backend=false` and ran `terraform validate` to ensure syntactical and logical correctness of our HCL:
```text
Success! The configuration is valid.
```

### 2. Vite Production Build Verification (`npm run build`)
We validated the JS/HTML layout using standard Vite production compilation:
```text
vite v5.4.21 building for production...
transforming...
✓ 4 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                 21.75 kB │ gzip:  5.68 kB
dist/assets/index-DHJXq3Hl.css  20.03 kB │ gzip:  4.34 kB
dist/assets/index-Vy3t7iG2.js   37.37 kB │ gzip: 10.25 kB
✓ built in 115ms
```
The build completes successfully with **zero warnings** and **zero compilation errors**.

### 3. Visual Sandbox Sandbox Verification
We performed live browser interactions and captured high-fidelity screenshots of the system components and visual states in action:

1.  **Standard Telemetry Forecast Interface (`screenshots/dashboard_normal.png`):** Shows full 30-day historical timeseries data plotted alongside a 14-day statistical forecast projection.
2.  **GNN Infrastructure Topology Map - Nominal State (`screenshots/dashboard_gnn_normal.png`):** Highlights active microservice linking with normal green pulse waves and automated HUD telemetry tracking Dim dimensions.
3.  **GNN Cascading Threat Wave - Anomaly Active (`screenshots/dashboard_gnn_cascade.png`):** Shows backward failure propagation cascading upstream from the database through services during dynamic anomaly injections.

---

## 🗺️ Architectural Structure

The resulting codebase structure is clean, highly modular, and production-ready:

```text
/Users/saffi/gsk-observability/
├── index.html                   # De-branded interactive dashboard shell
├── app.js                       # Generalized Client-Side simulation engine
├── styles.css                   # Premium Glassmorphic CSS design system
├── package.json                 # De-branded NPM project manifest
├── README.md                    # Complete step-by-step GCP Runbook & Playbook
├── walkthrough.md               # Detailed setup & verification walkthrough report
└── terraform/                   # Deployable GCP infrastructure suite
    ├── variables.tf             # Inputs config (Default project: gke-demos-363017)
    ├── main.tf                  # Providers setup
    ├── logging.tf               # Log Analytics & Log-based metric config
    ├── bigquery.tf              # BQ dataset & ML ARIMA setup job
    ├── monitoring.tf            # Native Predictive Alerts (forecast_options)
    ├── dashboard.tf             # Custom Cloud Monitoring Dashboard (jsonencode)
    ├── vertex_ai.tf             # Vertex AI GNN Model Endpoint & BQ Nodes/Edges tables
    └── outputs.tf               # Result URLs & IDs
```
