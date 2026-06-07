# Create the BigQuery Dataset for holding models, predictions, and anomaly logs.
resource "google_bigquery_dataset" "telemetry_dataset" {
  project    = var.project_id
  dataset_id = var.dataset_id
  location   = var.region

  description = "Dataset for GCP Observability Anomaly Forecasting & BQML ARIMA Models"
  
  labels = {
    env = "demo"
    iac = "terraform"
  }
}

# Execute BigQuery ML Model Training during deployment
# Note: This query creates or replaces an ARIMA_PLUS multi-series time-series forecasting model.
# To ensure instant and 100% reliable deployment in sandbox/demo environments (bypassing GCloud Log 
# Analytics linking delay and empty log states), we seed high-fidelity synthetic incident data.
resource "google_bigquery_job" "train_arima_model" {
  project  = var.project_id
  job_id   = "train_arima_incidents_job_${formatdate("YYYYMMDDHHmmss", timestamp())}"
  location = var.region # Ensure this matches your dataset location (us-central1)

  query {
    query = <<-SQL
      CREATE OR REPLACE MODEL `${var.project_id}.${var.dataset_id}.incident_volume_model`
      OPTIONS(
        model_type = 'ARIMA_PLUS',
        time_series_timestamp_col = 'timestamp',
        time_series_data_col = 'incident_count',
        time_series_id_col = 'country',
        holiday_region = 'GLOBAL',
        clean_spikes_and_dips = TRUE,
        adjust_step_changes = TRUE
      ) AS
      SELECT 
        ts as timestamp,
        country,
        CAST(ROUND(15 + 5 * SIN(EXTRACT(DAYOFYEAR FROM ts) / 10.0) + RAND() * 3) AS INT64) as incident_count
      FROM (
        SELECT ts, country
        FROM UNNEST(GENERATE_TIMESTAMP_ARRAY(TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY), CURRENT_TIMESTAMP(), INTERVAL 1 DAY)) as ts
        CROSS JOIN UNNEST(['US', 'GB', 'JP']) as country
      );
    SQL

    use_query_cache = true
    priority        = "INTERACTIVE"
  }

  depends_on = [
    google_bigquery_dataset.telemetry_dataset
  ]

  # Lifecycle policy to ignore job re-runs unless explicitly requested.
  lifecycle {
    ignore_changes = [job_id]
  }
}

# Create BigQuery View for live 14-day forecasts
resource "google_bigquery_table" "incident_volume_forecast_view" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.telemetry_dataset.dataset_id
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
    google_bigquery_job.train_arima_model
  ]
}

# Create BigQuery View for historical anomaly detection
resource "google_bigquery_table" "incident_volume_anomalies_view" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.telemetry_dataset.dataset_id
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
    google_bigquery_job.train_arima_model
  ]
}

# Create BigQuery View for candidate model evaluations
resource "google_bigquery_table" "incident_volume_evaluation_view" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.telemetry_dataset.dataset_id
  table_id   = "incident_volume_evaluation_view"

  view {
    query = <<-SQL
      SELECT * FROM ML.ARIMA_EVALUATE(
        MODEL `${var.project_id}.${var.dataset_id}.incident_volume_model`
      )
    SQL
    use_legacy_sql = false
  }

  depends_on = [
    google_bigquery_job.train_arima_model
  ]
}

# Create BigQuery View for model coefficients
resource "google_bigquery_table" "incident_volume_coefficients_view" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.telemetry_dataset.dataset_id
  table_id   = "incident_volume_coefficients_view"

  view {
    query = <<-SQL
      SELECT * FROM ML.ARIMA_COEFFICIENTS(
        MODEL `${var.project_id}.${var.dataset_id}.incident_volume_model`
      )
    SQL
    use_legacy_sql = false
  }

  depends_on = [
    google_bigquery_job.train_arima_model
  ]
}

