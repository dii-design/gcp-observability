# Create the BigQuery Dataset for holding models, predictions, and topology tables.
resource "google_bigquery_dataset" "observability_dataset" {
  project     = var.project_id
  dataset_id  = var.dataset_id
  location    = var.region
  description = "Dataset for Production Observability Anomaly Forecasting & GraphML Topology"
}

# Create table for GNN Topology Nodes
resource "google_bigquery_table" "graph_nodes" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.observability_dataset.dataset_id
  table_id   = "graph_nodes"

  schema = <<EOF
[
  {
    "name": "node_id",
    "type": "INTEGER",
    "mode": "REQUIRED",
    "description": "Unique identifier for the service node"
  },
  {
    "name": "node_name",
    "type": "STRING",
    "mode": "REQUIRED",
    "description": "Name of the service/microservice"
  },
  {
    "name": "service_type",
    "type": "STRING",
    "mode": "NULLABLE",
    "description": "Type of service (e.g. gateway, frontend, backend, database)"
  }
]
EOF
}

# Create table for GNN Topology Edges
resource "google_bigquery_table" "graph_edges" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.observability_dataset.dataset_id
  table_id   = "graph_edges"

  schema = <<EOF
[
  {
    "name": "edge_id",
    "type": "INTEGER",
    "mode": "REQUIRED",
    "description": "Unique identifier for the dependency edge"
  },
  {
    "name": "source_id",
    "type": "INTEGER",
    "mode": "REQUIRED",
    "description": "The node ID of the dependent service (caller)"
  },
  {
    "name": "destination_id",
    "type": "INTEGER",
    "mode": "REQUIRED",
    "description": "The node ID of the dependency service (callee)"
  },
  {
    "name": "dependency_type",
    "type": "STRING",
    "mode": "NULLABLE",
    "description": "Type of connection (e.g. HTTP, gRPC, DB)"
  }
]
EOF
}

# Execute BigQuery ML Model Training during deployment for application logs
resource "google_bigquery_job" "train_arima_incidents" {
  project  = var.project_id
  job_id   = "train_arima_incidents_${formatdate("YYYYMMDDHHmmss", timestamp())}"
  location = var.region

  query {
    query = <<-SQL
      # This job trains the ARIMA_PLUS forecasting model on real application logs
      CREATE OR REPLACE MODEL `${var.project_id}.${var.dataset_id}.incident_volume_model`
      OPTIONS(
        model_type = 'ARIMA_PLUS',
        time_series_timestamp_col = 'timestamp_bucket',
        time_series_data_col = 'error_count',
        time_series_id_col = 'service_name',
        holiday_region = 'GLOBAL',
        clean_spikes_and_dips = TRUE,
        adjust_step_changes = TRUE
      ) AS
      SELECT
        TIMESTAMP_TRUNC(timestamp, HOUR) AS timestamp_bucket,
        COALESCE(
          JSON_VALUE(resource.labels.container_name),
          JSON_VALUE(resource.labels.job),
          'unknown-service'
        ) AS service_name,
        COUNT(1) AS error_count
      FROM `${var.project_id}.${var.region}.${var.existing_log_bucket_name}._AllLogs`
      WHERE severity IN ('ERROR', 'CRITICAL', 'WARNING')
        AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
      GROUP BY 1, 2;
    SQL

    use_query_cache = true
    priority        = "INTERACTIVE"
  }

  depends_on = [
    google_bigquery_dataset.observability_dataset
  ]

  lifecycle {
    ignore_changes = [job_id]
  }
}

# Create BigQuery View for live 14-day forecasts from real log incident models
resource "google_bigquery_table" "incident_volume_forecast_view" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.observability_dataset.dataset_id
  table_id   = "incident_volume_forecast_view"

  view {
    query = <<-SQL
      SELECT * FROM ML.FORECAST(
        MODEL `${var.project_id}.${var.dataset_id}.incident_volume_model`,
        STRUCT(14 AS horizon, 0.95 AS confidence_level)
      )
    SQL
    use_legacy_sql = false
  }

  depends_on = [
    google_bigquery_job.train_arima_incidents
  ]
}

# Create BigQuery View for historical anomaly detection from real log incident models
resource "google_bigquery_table" "incident_volume_anomalies_view" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.observability_dataset.dataset_id
  table_id   = "incident_volume_anomalies_view"

  view {
    query = <<-SQL
      SELECT * FROM ML.DETECT_ANOMALIES(
        MODEL `${var.project_id}.${var.dataset_id}.incident_volume_model`,
        STRUCT(0.99 AS anomaly_prob_threshold)
      )
    SQL
    use_legacy_sql = false
  }

  depends_on = [
    google_bigquery_job.train_arima_incidents
  ]
}

# View to detect server unresponsiveness early (hang risk index)
resource "google_bigquery_table" "server_unresponsive_detection_view" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.observability_dataset.dataset_id
  table_id   = "server_unresponsive_detection_view"

  view {
    query = <<-SQL
      WITH cpu_data AS (
        SELECT
          TIMESTAMP_TRUNC(timestamp, MINUTE, 5) AS timestamp_bucket,
          COALESCE(resource.labels.instance_id, resource.labels.node_name, 'unknown-server') AS server_name,
          AVG(point.value.double_value) AS cpu_util
        FROM `${var.project_id}.${var.metrics_export_dataset_id}.time_series`
        WHERE metric.type IN ('compute.googleapis.com/instance/cpu/utilization', 'kubernetes.io/node/cpu/allocatable_utilization')
          AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
        GROUP BY 1, 2
      ),
      throughput_data AS (
        SELECT
          TIMESTAMP_TRUNC(timestamp, MINUTE, 5) AS timestamp_bucket,
          COALESCE(resource.labels.instance_id, resource.labels.node_name, 'unknown-server') AS server_name,
          AVG(point.value.double_value) AS throughput_rate
        FROM `${var.project_id}.${var.metrics_export_dataset_id}.time_series`
        WHERE metric.type IN ('compute.googleapis.com/instance/network/received_bytes_count', 'prometheus.googleapis.com/istio_requests_total/counter')
          AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
        GROUP BY 1, 2
      ),
      socket_data AS (
        SELECT
          TIMESTAMP_TRUNC(timestamp, MINUTE, 5) AS timestamp_bucket,
          COALESCE(resource.labels.instance_id, resource.labels.node_name, 'unknown-server') AS server_name,
          AVG(point.value.int64_value) AS active_connections
        FROM `${var.project_id}.${var.metrics_export_dataset_id}.time_series`
        WHERE metric.type IN ('compute.googleapis.com/instance/network/tcp_connections', 'prometheus.googleapis.com/node_netstat_Tcp_ActiveOpens/gauge')
          AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
        GROUP BY 1, 2
      )
      SELECT
        c.timestamp_bucket,
        c.server_name,
        c.cpu_util,
        COALESCE(t.throughput_rate, 0.0) AS throughput_rate,
        COALESCE(s.active_connections, 0) AS active_connections,
        # Spiked CPU (>85%) with low throughput and high connections indicates thread starvation hang
        CASE
          WHEN c.cpu_util > 0.85 AND COALESCE(t.throughput_rate, 0.0) < 1000.0 AND COALESCE(s.active_connections, 0) > 500 THEN 'CRITICAL: Thread Starvation / OS Hang Risk'
          WHEN c.cpu_util > 0.80 AND COALESCE(t.throughput_rate, 0.0) < 5000.0 THEN 'WARNING: High CPU / Low Throughput Anomaly'
          ELSE 'NOMINAL'
        END AS unresponsive_risk_state
      FROM cpu_data c
      LEFT JOIN throughput_data t ON c.timestamp_bucket = t.timestamp_bucket AND c.server_name = t.server_name
      LEFT JOIN socket_data s ON c.timestamp_bucket = s.timestamp_bucket AND c.server_name = s.server_name
    SQL
    use_legacy_sql = false
  }

  depends_on = [
    google_bigquery_dataset.observability_dataset
  ]
}

# View to detect database connectivity failure early
resource "google_bigquery_table" "connectivity_degradation_view" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.observability_dataset.dataset_id
  table_id   = "connectivity_degradation_view"

  view {
    query = <<-SQL
      SELECT
        TIMESTAMP_TRUNC(timestamp, MINUTE, 5) AS timestamp_bucket,
        COALESCE(
          JSON_VALUE(resource.labels.instance_id),
          JSON_VALUE(resource.labels.container_name),
          'unknown-service'
        ) AS service_name,
        COUNTIF(severity >= 'WARNING' AND (
          textPayload LIKE '%Connection pool exhausted%' OR
          textPayload LIKE '%Failed to obtain JDBC Connection%' OR
          textPayload LIKE '%Database connection timeout%' OR
          textPayload LIKE '%network connection loss%'
        )) AS db_connection_errors,
        COUNT(1) AS total_log_entries,
        SAFE_DIVIDE(
          COUNTIF(severity >= 'WARNING' AND (
            textPayload LIKE '%Connection%' OR
            textPayload LIKE '%Database%'
          )), 
          COUNT(1)
        ) AS db_error_ratio
      FROM `${var.project_id}.${var.region}.${var.existing_log_bucket_name}._AllLogs`
      WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
      GROUP BY 1, 2
    SQL
    use_legacy_sql = false
  }

  depends_on = [
    google_bigquery_dataset.observability_dataset
  ]
}

# View to identify reboot patterns masking systemic database failures
resource "google_bigquery_table" "recurring_incident_patterns_view" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.observability_dataset.dataset_id
  table_id   = "recurring_incident_patterns_view"

  view {
    query = <<-SQL
      WITH reboot_events AS (
        SELECT
          timestamp AS reboot_time,
          COALESCE(
            JSON_VALUE(resource.labels.instance_id),
            JSON_VALUE(resource.labels.container_name),
            'unknown-server'
          ) AS rebooted_server,
          textPayload AS reboot_reason
        FROM `${var.project_id}.${var.region}.${var.existing_log_bucket_name}._AllLogs`
        WHERE severity >= 'INFO'
          AND (
            textPayload LIKE '%system reboot%' OR
            textPayload LIKE '%starting container%' OR
            textPayload LIKE '%Tomcat starting%' OR
            textPayload LIKE '%APACHE%starting%' OR
            textPayload LIKE '%SQL Database server starting%'
          )
          AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
      ),
      subsequent_failures AS (
        SELECT
          r.reboot_time,
          r.rebooted_server,
          f.timestamp AS failure_time,
          COALESCE(
            JSON_VALUE(f.resource.labels.instance_id),
            JSON_VALUE(f.resource.labels.container_name)
          ) AS failing_server,
          f.textPayload AS failure_message,
          TIMESTAMP_DIFF(f.timestamp, r.reboot_time, MINUTE) AS minutes_since_reboot
        FROM reboot_events r
        JOIN `${var.project_id}.${var.region}.${var.existing_log_bucket_name}._AllLogs` f
          ON f.timestamp > r.reboot_time 
          AND f.timestamp <= TIMESTAMP_ADD(r.reboot_time, INTERVAL 2 HOUR)
        WHERE f.severity IN ('ERROR', 'CRITICAL')
          AND (
            JSON_VALUE(f.resource.labels.instance_id) LIKE 'zebosawn%' OR
            JSON_VALUE(f.resource.labels.instance_id) LIKE 'ZEBOSDWN%'
          )
      )
      SELECT
        reboot_time,
        rebooted_server,
        failure_time,
        failing_server,
        failure_message,
        minutes_since_reboot,
        'CRITICAL: Reboot fix failed. Systemic issue remains unresolved.' AS recurrence_analysis
      FROM subsequent_failures
      ORDER BY reboot_time DESC, failure_time ASC
    SQL
    use_legacy_sql = false
  }

  depends_on = [
    google_bigquery_dataset.observability_dataset
  ]
}
