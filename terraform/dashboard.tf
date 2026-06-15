# Create a Native Cloud Monitoring Dashboard
# Displays telemetry, forecasting trends, and log metrics in a single pane.
resource "google_monitoring_dashboard" "telemetry_forecasting_dashboard" {
  project        = var.project_id
  dashboard_json = jsonencode({
    displayName = "GCP Telemetry Anomaly Forecasting Control Center"
    gridLayout = {
      columns = 2
      widgets = [
        # Widget 1: CPU Utilization Timeseries (Native GKE Metric)
        {
          title = "GKE Node CPU Allocatable Utilization"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter   = "metric.type=\"kubernetes.io/node/cpu/allocatable_utilization\" AND resource.type=\"k8s_node\""
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_MEAN"
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
        # Widget 2: Memory Allocatable Utilization (Native GKE Metric)
        {
          title = "GKE Node Memory Allocatable Utilization"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter   = "metric.type=\"kubernetes.io/node/memory/allocatable_utilization\" AND resource.type=\"k8s_node\""
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_MEAN"
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
        # Widget 3: GCE Disk Write Bytes Tracking (Active Write Burst Metric)
        {
          title = "GCE Instance Disk Write Bytes (Physical Ephemeral Writes)"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter   = "metric.type=\"compute.googleapis.com/instance/disk/write_bytes_count\" AND resource.type=\"gce_instance\""
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_RATE"
                    crossSeriesReducer = "REDUCE_MEAN"
                    groupByFields      = ["resource.labels.instance_id"]
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
