# Create a Native Cloud Monitoring Dashboard
# Displays telemetry, forecasting trends, and log metrics in a single pane.
resource "google_monitoring_dashboard" "telemetry_forecasting_dashboard" {
  project        = var.project_id
  dashboard_json = jsonencode({
    displayName = "GCP Telemetry Anomaly Forecasting Control Center"
    gridLayout = {
      columns = 2
      widgets = [
        # Widget 1: CPU Utilization Timeseries
        {
          title = "Prometheus Cluster CPU Utilization"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter   = "metric.type=\"prometheus.googleapis.com/node_cpu_seconds_total/counter\" AND resource.type=\"k8s_node\""
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_RATE"
                    crossSeriesReducer = "REDUCE_MEAN"
                    groupByFields      = ["resource.labels.node_name"]
                  }
                }
              }
              plotType = "LINE"
            }]
            timeshiftDuration = "0s"
          }
        },
        # Widget 2: Memory Paging Storm Monitor
        {
          title = "Prometheus Memory Paging Ingress (Swap / Thrashing)"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter   = "metric.type=\"prometheus.googleapis.com/node_vmstat_pgpgin/counter\""
                  aggregation = {
                    alignmentPeriod    = "120s"
                    perSeriesAligner   = "ALIGN_RATE"
                    crossSeriesReducer = "REDUCE_SUM"
                  }
                }
              }
              plotType = "LINE"
            }]
            timeshiftDuration = "0s"
          }
        },
        # Widget 3: Disk Free Space Capacity
        {
          title = "Node Disk Capacity Tracking (Free Space)"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter   = "metric.type=\"prometheus.googleapis.com/node_filesystem_free_bytes/gauge\" AND resource.type=\"k8s_node\""
                  aggregation = {
                    alignmentPeriod    = "300s"
                    perSeriesAligner   = "ALIGN_MEAN"
                    crossSeriesReducer = "REDUCE_MEAN"
                  }
                }
              }
              plotType = "LINE"
            }]
            timeshiftDuration = "0s"
          }
        },
        # Widget 4: Log-Based ServiceNow Incident volume
        {
          title = "Service Incident Volume (Log-Based Metric)"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter   = "metric.type=\"logging.googleapis.com/user/servicenow_incident_count\""
                  aggregation = {
                    alignmentPeriod    = "900s"
                    perSeriesAligner   = "ALIGN_SUM"
                    crossSeriesReducer = "REDUCE_SUM"
                    groupByFields      = ["metric.labels.country"]
                  }
                }
              }
              plotType = "STACKED_BAR"
            }]
            timeshiftDuration = "0s"
          }
        }
      ]
    }
  })
}
