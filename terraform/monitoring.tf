# 1. Predictive Alert Policy: Predicted Disk Write Burst in 48 hours
resource "google_monitoring_alert_policy" "disk_exhaustion_forecast" {
  project      = var.project_id
  display_name = "Predictive Alert: Disk Write Volume Burst expected in 48 hours"
  combiner     = "OR"

  conditions {
    display_name = "Predicted Disk Write Bytes > 100MB/s"
    condition_threshold {
      filter          = "metric.type=\"compute.googleapis.com/instance/disk/write_bytes_count\" AND resource.type=\"gce_instance\""
      duration        = "1800s"
      comparison      = "COMPARISON_GT"
      threshold_value = 100000000 # 100 MB/s

      forecast_options {
        forecast_horizon = "172800s" # 48 Hours horizon (within 60h max limit)
      }

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  documentation {
    content   = "The disk write throughput is predicted to exceed 100MB/s within the next 48 hours based on the current disk I/O consumption trend."
    mime_type = "text/markdown"
  }
}

# 2. Predictive Alert Policy: Predicted RAM Exhaustion in 24 hours
resource "google_monitoring_alert_policy" "memory_exhaustion_forecast" {
  project      = var.project_id
  display_name = "Predictive Alert: Memory Exhaustion expected in 24 hours"
  combiner     = "OR"

  conditions {
    display_name = "Predicted RAM Used > 95%"
    condition_threshold {
      filter          = "metric.type=\"kubernetes.io/node/memory/allocatable_utilization\" AND resource.type=\"k8s_node\""
      duration        = "1800s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.95

      forecast_options {
        forecast_horizon = "86400s" # 24 Hours horizon (within 60h max limit)
      }

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  documentation {
    content   = "Node physical memory (RAM) is predicted to exceed 95% utilization within the next 24 hours based on current paging rates."
    mime_type = "text/markdown"
  }
}

# 3. Predictive Alert Policy: Predictive CPU Exhaustion in 4 hours
resource "google_monitoring_alert_policy" "cpu_exhaustion_forecast" {
  project      = var.project_id
  display_name = "Predictive Alert: CPU Exhaustion expected in 4 hours"
  combiner     = "OR"

  conditions {
    display_name = "Predicted CPU Used > 95%"
    condition_threshold {
      filter          = "metric.type=\"kubernetes.io/node/cpu/allocatable_utilization\" AND resource.type=\"k8s_node\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.95

      forecast_options {
        forecast_horizon = "14400s" # 4 Hours horizon (well within 60h limit)
      }

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  documentation {
    content   = "CPU utilization is predicted to exceed 95% within the next 4 hours based on the latest container workloads and scheduling peaks."
    mime_type = "text/markdown"
  }
}
