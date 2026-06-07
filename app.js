/* ----------------------------------------------------
   GCP Telemetry Observability Core Logic (app.js)
   ---------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  // --- GLOBAL STATE ---
  const state = {
    activeTab: 'overview',
    selectedDataset: 'cpu',
    sensitivity: 99.0, // slider val 80 - 99.9
    horizon: 14,      // slider val 1 - 30 days
    injectedAnomaly: null, // 'spike', 'drop', 'drift' or null
    chart: null,
    gnnAnimationId: null,
    telemetryData: {},
    logs: [],
    clockInterval: null
  };

  // --- TIME DISPLAY & CLOCK ---
  function updateClock() {
    const clockDisplay = document.getElementById('clock-display');
    if (clockDisplay) {
      const now = new Date();
      // format as 2026-06-07 17:21:00
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      clockDisplay.textContent = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
  }
  state.clockInterval = setInterval(updateClock, 1000);
  updateClock();

  // --- DATASET SPECS ---
  const datasetMeta = {
    cpu: { title: "Prometheus CPU Usage", cat: "Google Managed Prometheus", unit: "%", min: 0, max: 100, isCapacity: false },
    paging: { title: "Prometheus Memory Paging", cat: "Google Managed Prometheus", unit: "pages/s", min: 0, max: 1000, isCapacity: false },
    swap: { title: "Prometheus Swap Memory", cat: "Google Managed Prometheus", unit: "MB", min: 0, max: 2048, isCapacity: false },
    process_count: { title: "Prometheus Process Count", cat: "Google Managed Prometheus", unit: "processes", min: 0, max: 1000, isCapacity: false },
    phys_mem: { title: "Prometheus Physical Memory", cat: "Google Managed Prometheus", unit: "GB", min: 0, max: 128, isCapacity: false },
    threads: { title: "Prometheus System Threads", cat: "Google Managed Prometheus", unit: "threads", min: 0, max: 5000, isCapacity: false },
    servicenow_country: { title: "ServiceNow Incident Volume by Country", cat: "ServiceNow Logs", unit: "incidents", min: 0, max: 200, isCapacity: false },
    servicenow_location: { title: "ServiceNow Incident Volume by Site", cat: "ServiceNow Logs", unit: "incidents", min: 0, max: 150, isCapacity: false },
    disk_trend: { title: "Daily Disk Trend Aggregation", cat: "Capacity Trends", unit: "%", min: 0, max: 100, isCapacity: true },
    memory_trend: { title: "Memory Utilization Forecasting", cat: "Capacity Trends", unit: "%", min: 0, max: 100, isCapacity: true },
    gnn_topology: { title: "GNN Infrastructure Topology", cat: "Graph Neural Networks", unit: "%", min: 0, max: 100, isCapacity: false },
    logs_metrics_correlation: { title: "Logs & Timeseries Correlation", cat: "Unified Telemetry Correlation", unit: "co-occurrences", min: 0, max: 150, isCapacity: false }
  };

  // --- LOG WRITER ---
  const logConsole = document.getElementById('live-gcp-logs');
  function addLog(type, message) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const log = { id: Math.random(), time: timeStr, type, message };
    state.logs.unshift(log);
    
    // limit to 50 logs
    if (state.logs.length > 50) state.logs.pop();

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    let tag = "INFO";
    if (type === "warning") tag = "WARN";
    if (type === "anomaly") tag = "ANOMALY";

    entry.innerHTML = `
      <span class="log-time">${timeStr}</span>
      <span class="log-tag">${tag}</span>
      <span class="log-msg">${message}</span>
    `;

    if (logConsole) {
      logConsole.insertBefore(entry, logConsole.firstChild);
      // scroll to top
      logConsole.scrollTop = 0;
    }
  }

  // Inject initial logs
  addLog('info', 'Monarch backend connected successfully in gke-demos-363017.');
  addLog('info', 'Google Managed Prometheus (GMP) scraping 10 target metrics streams.');
  addLog('info', 'Cloud Logging Log Analytics linked dataset default.global initialized.');
  addLog('info', 'BigQuery ML serverless ARIMA_PLUS models loaded with holiday calendars.');

  // --- TELEMETRY SIMULATOR ---
  function generateBaseTelemetry(key) {
    const points = [];
    const baseLength = 30; // 30 historical days
    
    for (let i = 0; i < baseLength; i++) {
      let val = 0;
      let noise = (Math.random() - 0.5) * 5; // standard random noise

      switch(key) {
        case 'cpu':
          // cyclic diurnal pattern + random noise (40 - 70)
          val = 55 + Math.sin(i * 0.8) * 15 + noise;
          break;
        case 'paging':
          // stable paging with occasional small spikes
          val = 40 + (i === 12 ? 150 : i === 24 ? 210 : noise * 2);
          break;
        case 'swap':
          // near zero baseline, with sudden leak spike at index 22
          val = 10 + (i >= 22 ? 450 + (i - 22) * 50 : noise);
          break;
        case 'process_count':
          // flat-ish line of processes, drops significantly at index 25 representing service crash
          val = 320 + noise * 1.5 - (i >= 25 ? 180 : 0);
          break;
        case 'phys_mem':
          // diurnal wave, stable (e.g. 64GB - 85GB)
          val = 74 + Math.sin(i * 0.7) * 8 + noise * 0.5;
          break;
        case 'threads':
          // linear ramp up representing thread pool leak
          val = 1200 + i * 40 + noise * 10;
          break;
        case 'servicenow_country':
          // weekly business volumes, dips on weekends (indexes 5,6, 12,13, 19,20, 26,27)
          const isWeekend = (i % 7 === 5 || i % 7 === 6);
          val = isWeekend ? 35 + noise * 1.5 : 120 + Math.cos(i * 0.5) * 15 + noise * 3;
          break;
        case 'servicenow_location':
          // random location peaks (e.g. London site outage)
          val = 60 + (i === 15 ? 85 : i === 16 ? 70 : noise * 2);
          break;
        case 'disk_trend':
          // linear capacity buildup (60% to 75% over 30 days)
          val = 60 + i * 0.5 + (Math.random() - 0.5) * 0.5;
          break;
        case 'memory_trend':
          // weekly pattern capacity aggregation
          const isWk = (i % 7 === 5 || i % 7 === 6);
          val = 50 + (isWk ? -10 : 15) + (i * 0.2) + noise * 0.8;
          break;
        case 'gnn_topology':
          // Graph model health / stability
          val = 98.5 + (Math.random() - 0.5) * 1.2;
          break;
        case 'logs_metrics_correlation':
          // Unified telemetry correlation: higher load leads to higher warning incidents
          val = 45 + Math.sin(i * 0.8) * 20 + noise * 2.5;
          break;
      }
      
      // Clamp values
      const meta = datasetMeta[key];
      val = Math.max(meta.min, Math.min(meta.max, val));
      points.push(val);
    }
    return points;
  }

  // Generate dataset lists
  function buildAllDatasets() {
    const data = {};
    Object.keys(datasetMeta).forEach(key => {
      data[key] = generateBaseTelemetry(key);
    });
    state.telemetryData = data;
  }
  buildAllDatasets();

  // --- MATHEMATICAL FORECASTING & ANOMALY DETECTION ENGINE ---
  function computeModeling(datasetKey) {
    const historical = [...state.telemetryData[datasetKey]];
    const meta = datasetMeta[datasetKey];
    const n = historical.length;

    // Apply Injected Anomalies (if active and selected matches)
    if (state.injectedAnomaly && state.selectedDataset === datasetKey) {
      const idx = n - 2; // Inject at the near-end of history
      if (state.injectedAnomaly === 'spike') {
        historical[idx] = historical[idx] + (meta.max - meta.min) * 0.45;
      } else if (state.injectedAnomaly === 'drop') {
        historical[idx] = historical[idx] - (meta.max - meta.min) * 0.35;
      } else if (state.injectedAnomaly === 'drift') {
        // Step level shift for last 4 points
        for (let j = n - 4; j < n; j++) {
          historical[j] = historical[j] + (meta.max - meta.min) * 0.25;
        }
      }
      // Clamp injected points
      historical[idx] = Math.max(meta.min, Math.min(meta.max, historical[idx]));
    }

    // A) ANOMALY DETECTION (Rolling statistics & Z-Score confidence bounds)
    const rollingWindow = 6;
    const means = [];
    const stdDevs = [];
    const anomalies = [];
    
    // Map slider sensitivity to a statistical Z-Score
    // 99% -> 2.58, 95% -> 1.96, 90% -> 1.64, 80% -> 1.28
    const sens = state.sensitivity;
    let z = 2.58; // default 99%
    if (sens >= 99.5) z = 2.81;
    else if (sens >= 99.0) z = 2.58;
    else if (sens >= 95.0) z = 1.96;
    else if (sens >= 90.0) z = 1.64;
    else if (sens >= 85.0) z = 1.44;
    else z = 1.28;

    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - rollingWindow + 1);
      const sub = historical.slice(start, i + 1);
      const mean = sub.reduce((a, b) => a + b, 0) / sub.length;
      means.push(mean);

      const variance = sub.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / sub.length;
      const std = Math.sqrt(variance);
      stdDevs.push(std || 1.0); // prevent division by zero or zero bounds

      // Check if anomalous
      if (i >= rollingWindow) {
        // Look at rolling stats of the previous items to test the current point
        const prevMean = means[i - 1];
        const prevStd = stdDevs[i - 1];
        const diff = Math.abs(historical[i] - prevMean);
        
        if (diff > z * prevStd) {
          anomalies.push({ index: i, value: historical[i] });
        }
      }
    }

    // B) TIME SERIES FORECASTING (Linear Trend Extrapolation / Holt's-like Projection)
    // We fit a trend line on the last 12 points of history
    const fitLength = 12;
    const xSum = 0, ySum = 0, xySum = 0, xxSum = 0;
    let fitCount = 0;
    
    for (let i = n - fitLength; i < n; i++) {
      if (i < 0) continue;
      fitCount++;
    }
    
    // Linear regression on fit indices
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = n - fitLength; i < n; i++) {
      if (i < 0) continue;
      const x = i - (n - fitLength);
      const y = historical[i];
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    const slope = (fitCount * sumXY - sumX * sumY) / (fitCount * sumXX - sumX * sumX || 1.0);
    const intercept = (sumY - slope * sumX) / fitCount;

    // Project future timeline (horizon)
    const forecastMean = [];
    const forecastUpper = [];
    const forecastLower = [];
    
    // Extrapolate paging or swap differently (non-linear representations)
    const isPagingSwap = (datasetKey === 'paging' || datasetKey === 'swap');
    // Save last standard deviation for forecast uncertainty growth
    const lastStd = stdDevs[n - 1] || 5.0;

    for (let h = 1; h <= state.horizon; h++) {
      const xFuture = (n - 1 - (n - fitLength)) + h;
      let pred = slope * xFuture + intercept;
      
      // Special modeling for swap leakage/ paging storms
      if (isPagingSwap && slope > 0) {
        // Accelerating growth
        const lastVal = historical[n - 1];
        pred = lastVal + slope * h * (1 + h * 0.1);
      }

      // Special capacity disk exhaustion limits
      if (datasetKey === 'disk_trend') {
        const lastVal = historical[n - 1];
        pred = lastVal + slope * h;
      }

      pred = Math.max(meta.min, Math.min(meta.max, pred));
      forecastMean.push(pred);

      // Uncertainty expansion band: error bounds widen over time: std_t = std * sqrt(t)
      const forecastStd = lastStd * Math.sqrt(h);
      const upper = Math.min(meta.max, pred + z * forecastStd);
      const lower = Math.max(meta.min, pred - z * forecastStd);
      
      forecastUpper.push(upper);
      forecastLower.push(lower);
    }

    return {
      historical,
      anomalies,
      forecastMean,
      forecastUpper,
      forecastLower,
      mean: historical.reduce((a, b) => a + b, 0) / n,
      current: historical[n - 1],
      lastStd
    };
  }

  // --- SYNC CODES BLUEPRINTS ---
  const blueprints = {
    cpu: {
      bqml: `-- BQML Anomaly Detection is not typically run on raw high-frequency CPU metrics.
-- However, for aggregated metrics, you train ARIMA_PLUS on Prometheus CPU trends:

CREATE OR REPLACE MODEL \`gke-demos-363017.prometheus_forecasts.cpu_model\`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'timestamp',
  time_series_data_col = 'cpu_idle_avg',
  time_series_id_col = 'node_name',
  holiday_region = 'GLOBAL'
) AS
SELECT 
  timestamp,
  node_name,
  cpu_idle_avg
FROM \`gke-demos-363017.prometheus_metrics.node_cpu_daily\`
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 60 DAY);`,
      monitoring: `{
  "displayName": "Predictive Alert: CPU predicted exhaustion in 4 hours",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Prometheus CPU Forecast > 95%",
      "conditionThreshold": {
        "filter": "metric.type=\\"prometheus.googleapis.com/node_cpu_seconds_total/counter\\" AND resource.type=\\"k8s_node\\"",
        "duration": "60s",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.95,
        "forecastOptions": {
          "forecastHorizon": "14400s"
        }
      }
    }
  ]
}`,
      mql_promql: `# PromQL: Find nodes running above 85% CPU for the last 15 mins
sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) by (instance) / sum(rate(node_cpu_seconds_total[5m])) by (instance) * 100 > 85

# MQL: Dynamic threshold alert based on sliding 1-hour rolling standard deviation (3-sigma outlier)
fetch k8s_node
| metric 'prometheus.googleapis.com/node_cpu_seconds_total/counter'
| filter (mode != 'idle')
| align rate(5m)
| every 5m
| group_by [instance], [value_rate_sum: sum(value.counter)]
| window 1h
| {
    value value_rate_sum;
    let avg = mean(value_rate_sum);
    let dev = stddev(value_rate_sum);
    let thresh = avg + 3 * dev;
    value_rate_sum > thresh
  }`,
      terraform: `resource "google_monitoring_alert_policy" "cpu_forecast_alert" {
  project      = "gke-demos-363017"
  display_name = "Predictive Alert: High CPU Load Expected"
  combiner     = "OR"
  conditions {
    display_name = "Predicted CPU > 95%"
    condition_threshold {
      filter     = "metric.type=\\"prometheus.googleapis.com/node_cpu_seconds_total/counter\\" AND resource.type=\\"k8s_node\\""
      duration   = "60s"
      comparison = "COMPARISON_GT"
      threshold_value = 0.95
      forecast_options {
        forecast_horizon = "14400s" # 4 Hours forecast horizon
      }
    }
  }
}`
    },
    paging: {
      bqml: `-- Train ARIMA_PLUS model to track paging-storm trends across pods
CREATE OR REPLACE MODEL \`gke-demos-363017.prometheus_forecasts.paging_model\`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'timestamp',
  time_series_data_col = 'paging_rate',
  time_series_id_col = 'pod_name',
  clean_spikes_and_dips = FALSE -- Keep paging storms to train anomaly tolerance
) AS
SELECT timestamp, pod_name, paging_rate
FROM \`gke-demos-363017.prometheus_metrics.pod_paging_hourly\`
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY);`,
      monitoring: `{
  "displayName": "Prometheus Pod Memory Paging Outlier Detect",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Memory Paging Rate anomaly detected",
      "conditionThreshold": {
        "filter": "metric.type=\\"prometheus.googleapis.com/node_vmstat_pgpgin/counter\\"",
        "duration": "120s",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 500
      }
    }
  ]
}`,
      mql_promql: `# PromQL: Detect swap/paging storm on nodes
rate(node_vmstat_pgpgin[5m]) > 100 or rate(node_vmstat_pgpgout[5m]) > 100

# MQL: Log-scale paging rates to monitor micro-spikes
fetch gce_instance
| metric 'prometheus.googleapis.com/node_vmstat_pgpgin/counter'
| align rate(1m)
| every 1m
| map log10`,
      terraform: `resource "google_monitoring_alert_policy" "paging_storm" {
  project      = "gke-demos-363017"
  display_name = "Prometheus Paging Storm Alert"
  combiner     = "OR"
  conditions {
    display_name = "Paging Ingress > 500 pages/s"
    condition_threshold {
      filter     = "metric.type=\\"prometheus.googleapis.com/node_vmstat_pgpgin/counter\\""
      duration   = "120s"
      comparison = "COMPARISON_GT"
      threshold_value = 500
    }
  }
}`
    },
    swap: {
      bqml: `-- Detect Memory leaks in Swap utilization
CREATE OR REPLACE MODEL \`gke-demos-363017.prometheus_forecasts.swap_model\`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'timestamp',
  time_series_data_col = 'swap_used_mb',
  time_series_id_col = 'host_id'
) AS
SELECT timestamp, host_id, swap_used_mb
FROM \`gke-demos-363017.prometheus_metrics.node_swap_hourly\`;`,
      monitoring: `{
  "displayName": "Critical Swap Memory In-Use Forecast in 24h",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Predicted Swap Used > 1GB",
      "conditionThreshold": {
        "filter": "metric.type=\\"prometheus.googleapis.com/node_memory_SwapFree_bytes/gauge\\"",
        "duration": "60s",
        "comparison": "COMPARISON_LT",
        "thresholdValue": 1073741824,
        "forecastOptions": {
          "forecastHorizon": "86400s"
        }
      }
    }
  ]
}`,
      mql_promql: `# PromQL: Alert if swap free is below 15% and predicted to run out in 12 hours
(node_memory_SwapFree_bytes / node_memory_SwapTotal_bytes) < 0.15 and predict_linear(node_memory_SwapFree_bytes[4h], 43200) < 0

# MQL: Swap utilization forecast comparison
fetch gfr_node
| metric 'prometheus.googleapis.com/node_memory_SwapFree_bytes/gauge'
| align next_older(1m)
| every 1m
| {
    value [value_SwapFree: value.gauge];
    let expected_swap = predict_linear(value_SwapFree, 12h);
    expected_swap < 1000000000 -- Under 1GB free in 12h
  }`,
      terraform: `resource "google_monitoring_alert_policy" "swap_exhaustion" {
  project      = "gke-demos-363017"
  display_name = "Predictive Swap Exhaustion (24h)"
  combiner     = "OR"
  conditions {
    display_name = "Predicted Swap Free < 1GB"
    condition_threshold {
      filter     = "metric.type=\\"prometheus.googleapis.com/node_memory_SwapFree_bytes/gauge\\""
      duration   = "120s"
      comparison = "COMPARISON_LT"
      threshold_value = 1073741824
      forecast_options {
        forecast_horizon = "86400s"
      }
    }
  }
}`
    },
    process_count: {
      bqml: `-- Anomaly detection for process drops (representing daemon deaths / process crashes)
CREATE OR REPLACE MODEL \`gke-demos-363017.prometheus_forecasts.process_model\`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'timestamp',
  time_series_data_col = 'process_count',
  clean_spikes_and_dips = FALSE
) AS
SELECT timestamp, process_count
FROM \`gke-demos-363017.prometheus_metrics.node_process_hourly\`;`,
      monitoring: `{
  "displayName": "Alert on sudden process count drops",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Process count drops > 30% dynamically",
      "conditionThreshold": {
        "filter": "metric.type=\\"prometheus.googleapis.com/node_procs_running/gauge\\"",
        "duration": "120s",
        "comparison": "COMPARISON_LT",
        "thresholdValue": 100
      }
    }
  ]
}`,
      mql_promql: `# PromQL: Process drop indicator (compared with 1 hour ago)
node_procs_running < (node_procs_running offset 1h * 0.7)

# MQL: Sliding window rate change detect
fetch gce_instance
| metric 'prometheus.googleapis.com/node_procs_running/gauge'
| align mean(1m)
| every 1m
| timeshift 15m
| join (
    fetch gce_instance
    | metric 'prometheus.googleapis.com/node_procs_running/gauge'
    | align mean(1m)
    | every 1m
  )
| value [current: val(1), previous: val(0)]
| filter current < previous * 0.70`,
      terraform: `resource "google_monitoring_alert_policy" "process_count_drop" {
  project      = "gke-demos-363017"
  display_name = "Sudden Daemon Process Crash Alert"
  combiner     = "OR"
  conditions {
    display_name = "Daemon Processes < 100"
    condition_threshold {
      filter     = "metric.type=\\"prometheus.googleapis.com/node_procs_running/gauge\\""
      duration   = "60s"
      comparison = "COMPARISON_LT"
      threshold_value = 100
    }
  }
}`
    },
    phys_mem: {
      bqml: `-- Train an ARIMA model on physical memory utilization to capture diurnal trends
CREATE OR REPLACE MODEL \`gke-demos-363017.prometheus_forecasts.phys_mem_model\`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'timestamp',
  time_series_data_col = 'mem_used_gb'
) AS
SELECT timestamp, mem_used_gb
FROM \`gke-demos-363017.prometheus_metrics.mem_util_hourly\`;`,
      monitoring: `{
  "displayName": "Predictive Alert: Out of Memory (OOM) predicted in 6 hours",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Predicted RAM Used > 92%",
      "conditionThreshold": {
        "filter": "metric.type=\\"prometheus.googleapis.com/node_memory_Active_bytes/gauge\\"",
        "duration": "300s",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.92,
        "forecastOptions": {
          "forecastHorizon": "21600s"
        }
      }
    }
  ]
}`,
      mql_promql: `# PromQL: Check RAM free ratio
(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes > 0.90

# MQL: Dynamic threshold comparison based on RAM consumption rate
fetch gce_instance
| metric 'prometheus.googleapis.com/node_memory_Active_bytes/gauge'
| align next_older(1m)
| every 1m
| window 4h
| {
    value [ram_active: value.gauge];
    ram_active > 0.92 * 16000000000 -- alert if 92% of 16GB
  }`,
      terraform: `resource "google_monitoring_alert_policy" "phys_mem_forecast" {
  project      = "gke-demos-363017"
  display_name = "Predictive RAM OOM Alert (6h)"
  combiner     = "OR"
  conditions {
    display_name = "Predicted RAM Used > 92%"
    condition_threshold {
      filter     = "metric.type=\\"prometheus.googleapis.com/node_memory_Active_bytes/gauge\\""
      duration   = "300s"
      comparison = "COMPARISON_GT"
      threshold_value = 0.92
      forecast_options {
        forecast_horizon = "21600s" # 6h
      }
    }
  }
}`
    },
    threads: {
      bqml: `-- Train ARIMA_PLUS model to monitor thread counts and detect thread exhaustion
CREATE OR REPLACE MODEL \`gke-demos-363017.prometheus_forecasts.thread_model\`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'timestamp',
  time_series_data_col = 'thread_count'
) AS
SELECT timestamp, thread_count
FROM \`gke-demos-363017.prometheus_metrics.node_threads_daily\`;`,
      monitoring: `{
  "displayName": "Predictive Alert: System Thread Pool Exhaustion in 12h",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Thread Count > 4500",
      "conditionThreshold": {
        "filter": "metric.type=\\"prometheus.googleapis.com/node_threads/gauge\\"",
        "duration": "120s",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 4500,
        "forecastOptions": {
          "forecastHorizon": "43200s"
        }
      }
    }
  ]
}`,
      mql_promql: `# PromQL: Thread Count growing fast
derivative(node_threads[30m]) > 20

# MQL: Check thread rate change
fetch gce_instance
| metric 'prometheus.googleapis.com/node_threads/gauge'
| align mean(5m)
| every 5m
| delta 1h`,
      terraform: `resource "google_monitoring_alert_policy" "thread_exhaustion" {
  project      = "gke-demos-363017"
  display_name = "Predictive Thread Exhaustion Alert"
  combiner     = "OR"
  conditions {
    display_name = "Threads predicted > 4500"
    condition_threshold {
      filter     = "metric.type=\\"prometheus.googleapis.com/node_threads/gauge\\""
      duration   = "120s"
      comparison = "COMPARISON_GT"
      threshold_value = 4500
      forecast_options {
        forecast_horizon = "43200s"
      }
    }
  }
}`
    },
    servicenow_country: {
      bqml: `-- MULTI-SERIES FORECASTING (Kibana ML equivalent) on ServiceNow logs.
-- This trains ARIMA_PLUS on log ingestion volume grouped by country.

CREATE OR REPLACE MODEL \`gke-demos-363017.servicenow_forecasts.country_incident_model\`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'timestamp',
  time_series_data_col = 'incident_count',
  time_series_id_col = 'country', -- Models each country independently in 1 SQL query!
  holiday_region = 'GLOBAL',
  clean_spikes_and_dips = TRUE,
  adjust_step_changes = TRUE
) AS
SELECT 
  TIMESTAMP(FORMAT_TIMESTAMP('%Y-%m-%d 00:00:00', timestamp)) as timestamp,
  jsonPayload.country,
  COUNT(1) as incident_count
FROM \`gke-demos-363017.global._Default._AllLogs\`
WHERE logName LIKE '%servicenow%'
  AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
GROUP BY 1, 2;

-- Running historical anomaly detection
SELECT *
FROM ML.DETECT_ANOMALIES(
  MODEL \`gke-demos-363017.servicenow_forecasts.country_incident_model\`,
  STRUCT(0.99 AS anomaly_prob_threshold)
)
ORDER BY timestamp DESC;

-- Advanced Model Evaluation (inspect ARIMA order, seasonal components, AIC, BIC)
SELECT *
FROM ML.ARIMA_EVALUATE(MODEL \`gke-demos-363017.servicenow_forecasts.country_incident_model\`);

-- Explain Forecast (decompose trend, seasonal, holiday, and step-changes)
SELECT *
FROM ML.EXPLAIN_FORECAST(
  MODEL \`gke-demos-363017.servicenow_forecasts.country_incident_model\`,
  STRUCT(14 AS horizon, 0.95 AS confidence_level)
);

-- Retrieve coefficients (inspect AR, MA, drift, and intercept coefficients)
SELECT *
FROM ML.ARIMA_COEFFICIENTS(MODEL \`gke-demos-363017.servicenow_forecasts.country_incident_model\`);`,
      monitoring: `-- Alerting on ServiceNow logs via Log-Based Metrics
-- Once ServiceNow Log Analytics exports metric, alert if count > threshold in 15m
{
  "displayName": "GCP Alert: ServiceNow High Incident Volume Country Peak",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Log Count > 150/15m",
      "conditionThreshold": {
        "filter": "metric.type=\\"logging.googleapis.com/user/servicenow_incident_count\\" AND resource.type=\\"global\\"",
        "duration": "900s",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 150
      }
    }
  ]
}`,
      mql_promql: `# MQL query over Log-Based metrics. Groups by country, aligns sum in 1-hour windows
fetch global
| metric 'logging.googleapis.com/user/servicenow_incident_count'
| align sum(1h)
| every 1h
| group_by [metric.labels.country], [total_incidents: sum(value.servicenow_incident_count)]
| window 4h
| {
    value total_incidents;
    let avg = mean(total_incidents);
    let dev = stddev(total_incidents);
    total_incidents > (avg + 3 * dev)
  }`,
      terraform: `resource "google_monitoring_alert_policy" "servicenow_country_alert" {
  project      = "gke-demos-363017"
  display_name = "ServiceNow High Incident Country Spike"
  combiner     = "OR"
  conditions {
    display_name = "ServiceNow Logs Country Count > 150"
    condition_threshold {
      filter     = "metric.type=\\"logging.googleapis.com/user/servicenow_incident_count\\" AND resource.type=\\"global\\""
      duration   = "900s"
      comparison = "COMPARISON_GT"
      threshold_value = 150
    }
  }
}`
    },
    servicenow_location: {
      bqml: `-- Train multi-series ARIMA model to track incident volume partitioned by site location
CREATE OR REPLACE MODEL \`gke-demos-363017.servicenow_forecasts.site_incident_model\`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'timestamp',
  time_series_data_col = 'incident_count',
  time_series_id_col = 'site_location',
  holiday_region = 'GLOBAL',
  clean_spikes_and_dips = TRUE
) AS
SELECT 
  TIMESTAMP(FORMAT_TIMESTAMP('%Y-%m-%d 00:00:00', timestamp)) as timestamp,
  jsonPayload.location as site_location,
  COUNT(1) as incident_count
FROM \`gke-demos-363017.global._Default._AllLogs\`
WHERE logName LIKE '%servicenow%'
GROUP BY 1, 2;

-- Running historical anomaly detection
SELECT *
FROM ML.DETECT_ANOMALIES(
  MODEL \`gke-demos-363017.servicenow_forecasts.site_incident_model\`,
  STRUCT(0.99 AS anomaly_prob_threshold)
)
ORDER BY timestamp DESC;

-- Advanced Model Evaluation (inspect ARIMA order, seasonal components, AIC, BIC)
SELECT *
FROM ML.ARIMA_EVALUATE(MODEL \`gke-demos-363017.servicenow_forecasts.site_incident_model\`);

-- Explain Forecast (decompose trend, seasonal, holiday, and step-changes)
SELECT *
FROM ML.EXPLAIN_FORECAST(
  MODEL \`gke-demos-363017.servicenow_forecasts.site_incident_model\`,
  STRUCT(14 AS horizon, 0.95 AS confidence_level)
);

-- Retrieve coefficients (inspect AR, MA, drift, and intercept coefficients)
SELECT *
FROM ML.ARIMA_COEFFICIENTS(MODEL \`gke-demos-363017.servicenow_forecasts.site_incident_model\`);`,
      monitoring: `{
  "displayName": "GCP Alert: ServiceNow Incident Volume Site Outlier",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Site Outlier Incident Volume > 100",
      "conditionThreshold": {
        "filter": "metric.type=\\"logging.googleapis.com/user/servicenow_incident_count\\"",
        "duration": "900s",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 100
      }
    }
  ]
}`,
      mql_promql: `# MQL: Dynamic threshold alert for localized site outages
fetch global
| metric 'logging.googleapis.com/user/servicenow_incident_count'
| align sum(30m)
| every 30m
| group_by [metric.labels.site], [site_sum: sum(value.servicenow_incident_count)]
| window 2h
| {
    value site_sum;
    let avg = mean(site_sum);
    let dev = stddev(site_sum);
    site_sum > (avg + 4 * dev) -- Strict 4-sigma check
  }`,
      terraform: `resource "google_monitoring_alert_policy" "servicenow_site_alert" {
  project      = "gke-demos-363017"
  display_name = "ServiceNow High Incident Site Outlier"
  combiner     = "OR"
  conditions {
    display_name = "ServiceNow Site Count > 100"
    condition_threshold {
      filter     = "metric.type=\\"logging.googleapis.com/user/servicenow_incident_count\\""
      duration   = "900s"
      comparison = "COMPARISON_GT"
      threshold_value = 100
    }
  }
}`
    },
    disk_trend: {
      bqml: `-- Capacity Trend Analysis using ARIMA_PLUS on Disk Usage
CREATE OR REPLACE MODEL \`gke-demos-363017.capacity_models.disk_usage_model\`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'timestamp',
  time_series_data_col = 'disk_used_percentage',
  clean_spikes_and_dips = TRUE,
  adjust_step_changes = TRUE
) AS
SELECT timestamp, disk_used_percentage
FROM \`gke-demos-363017.capacity_metrics.disk_daily_aggregation\`
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 120 DAY);

-- Run Forecast to predict exact day of disk exhaustion (crossing 95%)
SELECT 
  forecast_time, 
  forecast_value,
  prediction_interval_lower_bound,
  prediction_interval_upper_bound
FROM ML.FORECAST(
  MODEL \`gke-demos-363017.capacity_models.disk_usage_model\`,
  STRUCT(60 AS horizon, 0.95 AS confidence_level)
)
WHERE forecast_value >= 95.0
ORDER BY forecast_time ASC
LIMIT 1;`,
      monitoring: `{
  "displayName": "Critical Predictive Alert: Disk Storage Exhaustion expected in 7 days",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Predicted Disk Space Used > 90%",
      "conditionThreshold": {
        "filter": "metric.type=\\"prometheus.googleapis.com/node_filesystem_free_bytes/gauge\\"",
        "duration": "300s",
        "comparison": "COMPARISON_LT",
        "thresholdValue": 107374182400, -- 100GB left
        "forecastOptions": {
          "forecastHorizon": "604800s" -- 7 Days
        }
      }
    }
  ]
}`,
      mql_promql: `# PromQL: Alert if disk is predicted to run out of space within 7 days
predict_linear(node_filesystem_free_bytes{mountpoint="/"}[2d], 604800) < 0

# MQL: Predict 7-day disk capacity bounds
fetch k8s_node
| metric 'prometheus.googleapis.com/node_filesystem_free_bytes/gauge'
| filter mountpoint == '/'
| align next_older(1h)
| every 1h
| {
    value [disk_free: value.gauge];
    let forecast_free = predict_linear(disk_free, 7d);
    forecast_free < 0 -- predicted full
  }`,
      terraform: `resource "google_monitoring_alert_policy" "disk_7day_forecast" {
  project      = "gke-demos-363017"
  display_name = "Predictive Alert: Disk Exhaustion in 7 days"
  combiner     = "OR"
  conditions {
    display_name = "Predicted Disk Space Full < 100GB"
    condition_threshold {
      filter     = "metric.type=\\"prometheus.googleapis.com/node_filesystem_free_bytes/gauge\\""
      duration   = "300s"
      comparison = "COMPARISON_LT"
      threshold_value = 107374182400
      forecast_options {
        forecast_horizon = "604800s" # 7 Days horizon
      }
    }
  }
}`
    },
    memory_trend: {
      bqml: `-- Forecast weekly/diurnal memory capacity patterns
CREATE OR REPLACE MODEL \`gke-demos-363017.capacity_models.memory_model\`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'timestamp',
  time_series_data_col = 'memory_used_percentage',
  holiday_region = 'GLOBAL'
) AS
SELECT timestamp, memory_used_percentage
FROM \`gke-demos-363017.capacity_metrics.memory_daily_aggregation\`;`,
      monitoring: `{
  "displayName": "Predictive Alert: Memory Exhaustion expected in 3 days",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Predicted RAM Used > 95%",
      "conditionThreshold": {
        "filter": "metric.type=\\"prometheus.googleapis.com/node_memory_Active_bytes/gauge\\"",
        "duration": "300s",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.95,
        "forecastOptions": {
          "forecastHorizon": "259200s"
        }
      }
    }
  ]
}`,
      mql_promql: `# PromQL: Alert if memory predicted to exceed 95% in 3 days (259200s)
predict_linear(node_memory_Active_bytes[1d], 259200) > (node_memory_MemTotal_bytes * 0.95)

# MQL: Memory limit forecasting alert
fetch k8s_node
| metric 'prometheus.googleapis.com/node_memory_Active_bytes/gauge'
| align next_older(1h)
| every 1h
| {
    value [mem_active: value.gauge];
    let pred_mem = predict_linear(mem_active, 3d);
    pred_mem > 32000000000 -- Exceed 32GB RAM
  }`,
      terraform: `resource "google_monitoring_alert_policy" "memory_3day_forecast" {
  project      = "gke-demos-363017"
  display_name = "Predictive Alert: RAM Exhaustion in 3 days"
  combiner     = "OR"
  conditions {
    display_name = "Predicted RAM Used > 95%"
    condition_threshold {
      filter     = "metric.type=\\"prometheus.googleapis.com/node_memory_Active_bytes/gauge\\""
      duration   = "300s"
      comparison = "COMPARISON_GT"
      threshold_value = 0.95
      forecast_options {
        forecast_horizon = "259200s" # 3 Days horizon
      }
    }
  }
}`
    },
    gnn_topology: {
      bqml: `-- 1. DECLARE PROPERTY GRAPH SCHEMA NATIVELY IN BIGQUERY
-- Create node/edge views and define graph connectivity

CREATE OR REPLACE PROPERTY GRAPH \`gke-demos-363017.telemetry_graph.topology_graph\`
NODE TABLES (
  \`gke-demos-363017.telemetry_graph.graph_nodes\`
    KEY (node_id)
    LABEL Node { node_name, service_type }
)
EDGE TABLES (
  \`gke-demos-363017.telemetry_graph.graph_edges\`
    KEY (edge_id)
    SOURCE KEY (source_id) REFERENCES graph_nodes (node_id)
    DESTINATION KEY (destination_id) REFERENCES graph_nodes (node_id)
    LABEL DEPENDS_ON { dependency_type }
);

-- 2. QUERY MULTI-HOP PATHS DOWNSTREAM FROM DATABASE TO TRACE DOWNSTREAM THREAT CASCADE
SELECT source_node, dest_node
FROM GRAPH_TABLE(
  \`gke-demos-363017.telemetry_graph.topology_graph\`
  MATCH (src:Node {node_name: "payment-db"})-[e:DEPENDS_ON*1..3]->(dst:Node)
  COLUMNS(src.node_name AS source_node, dst.node_name AS dest_node)
);`,
      monitoring: `{
  "displayName": "GNN Cascade Alert: High downstream anomaly propagation risk",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "GNN Endpoint Failure Propagation Probability > 75%",
      "conditionThreshold": {
        "filter": "metric.type=\\"custom.googleapis.com/gnn/cascade_risk_probability\\" AND resource.type=\\"global\\"",
        "duration": "60s",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.75
      }
    }
  ]
}`,
      mql_promql: `# PromQL: Alert on joint-anomaly latency correlation in dependencies (cascade precursor)
(http_request_duration_seconds{service="payment-service"} > 0.15) 
  and on(instance) 
(rate(mysql_global_status_threads_running[5m]) > 45)

# MQL: Correlate latency spikes across dependency paths
fetch k8s_container
| metric 'kubernetes.io/container/cpu/usage_time'
| filter container_name == 'payment-db'
| align rate(1m) | every 1m
| join (
    fetch k8s_container
    | metric 'kubernetes.io/container/cpu/usage_time'
    | filter container_name == 'payment-service'
    | align rate(1m) | every 1m
  )
| value [db_cpu: val(0), svc_cpu: val(1)]
| filter db_cpu > 0.85 AND svc_cpu > 0.90`,
      terraform: `# Deploy Vertex AI Model Endpoint for Graph Neural Network
resource "google_vertex_ai_endpoint" "gnn_endpoint" {
  project      = "gke-demos-363017"
  name         = "gnn-cascade-predictor"
  display_name = "GNN Anomaly Cascade Predictor Endpoint"
  location     = "us-central1"
}

# BigQuery Table for Graph Nodes
resource "google_bigquery_table" "graph_nodes" {
  dataset_id = "telemetry_anomaly_forecasts"
  table_id   = "graph_nodes"
  schema     = <<EOF
[
  {"name": "node_id", "type": "STRING", "mode": "REQUIRED"},
  {"name": "node_name", "type": "STRING", "mode": "REQUIRED"},
  {"name": "service_type", "type": "STRING", "mode": "NULLABLE"},
  {"name": "cpu_util", "type": "FLOAT", "mode": "NULLABLE"},
  {"name": "mem_util", "type": "FLOAT", "mode": "NULLABLE"}
]
EOF
}`
    },
    logs_metrics_correlation: {
      bqml: `-- BQML CORRELATION OF LOGS AND METRIC TIMESERIES IN BIGQUERY
-- 
-- 1. Enable Log Analytics on your Cloud Logging bucket to stream logs to BigQuery.
-- 2. Enable continuous Cloud Monitoring BigQuery Export to stream timeseries metrics to BigQuery.
-- 3. Run this query to bucket both datasets into 5-minute intervals and join on resource ID.

WITH metrics_5m AS (
  -- Aggregate high-frequency timeseries metrics into 5-minute buckets
  SELECT
    TIMESTAMP_TRUNC(timestamp, MINUTE, 5) AS timestamp_bucket,
    resource.labels.node_name AS node_id,
    AVG(point.value.double_value) AS avg_cpu_utilization
  FROM \`gke-demos-363017.monitoring_export.time_series\`
  WHERE metric.type = 'kubernetes.io/container/cpu/limit_utilization'
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  GROUP BY 1, 2
),

logs_5m AS (
  -- Aggregate arbitrary log occurrences (Warnings/Errors) into 5-minute buckets
  SELECT
    TIMESTAMP_TRUNC(timestamp, MINUTE, 5) AS timestamp_bucket,
    COALESCE(
      JSON_VALUE(resource.labels.node_name),
      JSON_VALUE(jsonPayload.node_name),
      "unknown-node"
    ) AS node_id,
    COUNT(1) AS log_error_count
  FROM \`gke-demos-363017.global._Default._AllLogs\`
  WHERE severity IN ('ERROR', 'CRITICAL', 'WARNING')
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  GROUP BY 1, 2
)

-- FULL JOIN to correlate metrics with log incidents
SELECT
  COALESCE(m.timestamp_bucket, l.timestamp_bucket) AS timestamp,
  COALESCE(m.node_id, l.node_id) AS node_id,
  COALESCE(m.avg_cpu_utilization, 0.0) AS cpu_utilization,
  COALESCE(l.log_error_count, 0) AS error_count,
  
  -- Flag instances where high metrics correlate directly with log errors
  CASE
    WHEN m.avg_cpu_utilization > 0.85 AND l.log_error_count > 10 THEN 'CRITICAL CORRELATION: METRIC SPIKE COINCIDES WITH ERROR LOGS'
    WHEN m.avg_cpu_utilization > 0.85 THEN 'METRIC SPIKE ONLY'
    WHEN l.log_error_count > 10 THEN 'LOG ERROR SPIKE ONLY'
    ELSE 'NOMINAL'
  END AS correlation_state
FROM metrics_5m m
FULL OUTER JOIN logs_5m l
  ON m.timestamp_bucket = l.timestamp_bucket
  AND m.node_id = l.node_id
ORDER BY timestamp DESC, cpu_utilization DESC;`,
      monitoring: `{
  "displayName": "Unified Telemetry: CPU Spike & Log Error Correlation Alert",
  "combiner": "AND",
  "conditions": [
    {
      "displayName": "GKE Node CPU > 85%",
      "conditionThreshold": {
        "filter": "metric.type=\\"kubernetes.io/container/cpu/limit_utilization\\" AND resource.type=\\"k8s_node\\"",
        "duration": "300s",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.85
      }
    },
    {
      "displayName": "Log-Based Metric Error Count > 10/5m",
      "conditionThreshold": {
        "filter": "metric.type=\\"logging.googleapis.com/user/node_error_count\\" AND resource.type=\\"k8s_node\\"",
        "duration": "300s",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 10
      }
    }
  ]
}`,
      mql_promql: `# MQL: Continuously correlate Metric Spikes & Error Logs in Cloud Monitoring Monarch
join
  (
    fetch k8s_node
    | metric 'kubernetes.io/container/cpu/limit_utilization'
    | align mean(5m) | every 5m
    | group_by [node_name]
  ),
  (
    fetch k8s_node
    | metric 'logging.googleapis.com/user/node_error_count'
    | align sum(5m) | every 5m
    | group_by [node_name]
  )
| value [cpu_util: val(0), err_count: val(1)]
| filter cpu_util > 0.85 AND err_count > 10`,
      terraform: `# Provision a dual-signal alert policy in Cloud Monitoring via Terraform
resource "google_monitoring_alert_policy" "unified_correlation_alert" {
  project      = "gke-demos-363017"
  display_name = "Unified Telemetry: High CPU & Error Log Spike Correlation"
  combiner     = "AND"

  conditions {
    display_name = "Node CPU Utilization > 85%"
    condition_threshold {
      filter     = "metric.type=\\"kubernetes.io/container/cpu/limit_utilization\\" AND resource.type=\\"k8s_node\\""
      duration   = "300s"
      comparison = "COMPARISON_GT"
      threshold_value = 0.85
    }
  }

  conditions {
    display_name = "Concurrent Node Error Logs > 10 in 5m"
    condition_threshold {
      filter     = "metric.type=\\"logging.googleapis.com/user/node_error_count\\" AND resource.type=\\"k8s_node\\""
      duration   = "300s"
      comparison = "COMPARISON_GT"
      threshold_value = 10
    }
  }
}`
    }
  };

  // --- CUSTOM GRAPH NEURAL NETWORK VISUALIZER (TOPOLOGY MAP) ---
  function drawTopologyNetwork() {
    const canvas = document.getElementById('telemetry-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Cancel any active animation frame
    if (state.gnnAnimationId) {
      cancelAnimationFrame(state.gnnAnimationId);
    }
    
    // Define GNN Nodes with normalized responsive coordinates
    const nodes = [
      { id: 'lb', name: 'Load Balancer', role: 'ingress', x: 0.15, y: 0.5, status: 'healthy', risk: 0, val: 99.4, unit: 'req/s' },
      { id: 'gw', name: 'API Gateway', role: 'api-gw', x: 0.35, y: 0.5, status: 'healthy', risk: 0, val: 99.4, unit: 'req/s' },
      { id: 'auth', name: 'Auth Service', role: 'auth-service', x: 0.58, y: 0.25, status: 'healthy', risk: 0, val: 12.4, unit: 'ms' },
      { id: 'pay', name: 'Payment Service', role: 'payment-service', x: 0.58, y: 0.75, status: 'healthy', risk: 0, val: 18.2, unit: 'ms' },
      { id: 'db', name: 'Payment DB', role: 'db-primary', x: 0.82, y: 0.5, status: 'healthy', risk: 0, val: 2.1, unit: 'ms' }
    ];
    
    const edges = [
      { from: 'lb', to: 'gw' },
      { from: 'gw', to: 'auth' },
      { from: 'gw', to: 'pay' },
      { from: 'auth', to: 'db' },
      { from: 'pay', to: 'db' }
    ];
    
    // Floating particles (information flows)
    const particles = [];
    const maxParticles = 25;
    for (let i = 0; i < maxParticles; i++) {
      particles.push({
        edgeIndex: Math.floor(Math.random() * edges.length),
        progress: Math.random(),
        speed: 0.003 + Math.random() * 0.007
      });
    }
    
    let waveOffset = 0;
    
    function animate() {
      // Check if we are still active on sandbox and selectedDataset is gnn_topology
      if (state.activeTab !== 'sandbox' || state.selectedDataset !== 'gnn_topology') {
        cancelAnimationFrame(state.gnnAnimationId);
        state.gnnAnimationId = null;
        return;
      }
      
      const w = canvas.width = canvas.parentElement.clientWidth;
      const h = canvas.height = canvas.parentElement.clientHeight || 350;
      
      // Night theme backdrop
      ctx.fillStyle = '#0b0f19';
      ctx.fillRect(0, 0, w, h);
      
      // Draw Grid System for sci-fi HUD appearance
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.015)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      
      // Recalculate dynamic values depending on user-injected anomaly
      let cascadeRiskAuth = 0;
      let cascadeRiskPay = 0;
      let cascadeRiskGW = 0;
      let cascadeRiskLB = 0;
      
      let dbStatus = 'healthy';
      let payStatus = 'healthy';
      let authStatus = 'healthy';
      let gwStatus = 'healthy';
      let lbStatus = 'healthy';
      
      if (state.injectedAnomaly) {
        if (state.injectedAnomaly === 'spike') {
          dbStatus = 'anomalous';
          payStatus = 'warning';
          gwStatus = 'warning';
          cascadeRiskPay = 88.4;
          cascadeRiskGW = 65.2;
          cascadeRiskLB = 12.8;
        } else if (state.injectedAnomaly === 'drop') {
          dbStatus = 'anomalous';
          payStatus = 'anomalous';
          gwStatus = 'warning';
          cascadeRiskPay = 99.8;
          cascadeRiskGW = 84.1;
          cascadeRiskLB = 22.4;
        } else if (state.injectedAnomaly === 'drift') {
          authStatus = 'warning';
          gwStatus = 'warning';
          cascadeRiskGW = 45.0;
        }
      }
      
      // Sync node health states
      nodes.forEach(n => {
        if (n.id === 'db') {
          n.status = dbStatus;
          n.risk = dbStatus === 'anomalous' ? 100 : 0;
          n.val = dbStatus === 'anomalous' ? 148.5 : 2.1 + Math.sin(Date.now() / 1000) * 0.2;
        } else if (n.id === 'pay') {
          n.status = payStatus;
          n.risk = cascadeRiskPay;
          n.val = payStatus === 'anomalous' ? 245.0 : payStatus === 'warning' ? 78.4 : 18.2 + Math.sin(Date.now() / 1200) * 1.5;
        } else if (n.id === 'auth') {
          n.status = authStatus;
          n.risk = authStatus === 'warning' ? 45.0 : 0;
          n.val = authStatus === 'warning' ? 95.2 : 12.4 + Math.sin(Date.now() / 1500) * 0.8;
        } else if (n.id === 'gw') {
          n.status = gwStatus;
          n.risk = cascadeRiskGW;
          n.val = gwStatus === 'warning' ? 145.2 : 99.4 + Math.sin(Date.now() / 800) * 2.0;
        } else if (n.id === 'lb') {
          n.status = lbStatus;
          n.risk = cascadeRiskLB;
          n.val = 99.4 + Math.sin(Date.now() / 800) * 2.0;
        }
      });
      
      waveOffset += 0.08;
      
      // DRAW EDGES
      edges.forEach(e => {
        const fromNode = nodes.find(n => n.id === e.from);
        const toNode = nodes.find(n => n.id === e.to);
        if (!fromNode || !toNode) return;
        
        const fx = fromNode.x * w;
        const fy = fromNode.y * h;
        const tx = toNode.x * w;
        const ty = toNode.y * h;
        
        // Edge highlights on failure cascades
        let isThreatEdge = false;
        if (state.injectedAnomaly) {
          if (state.injectedAnomaly === 'spike' || state.injectedAnomaly === 'drop') {
            if ((e.from === 'pay' && e.to === 'db') || (e.from === 'gw' && e.to === 'pay')) {
              isThreatEdge = true;
            }
          } else if (state.injectedAnomaly === 'drift') {
            if ((e.from === 'gw' && e.to === 'auth')) {
              isThreatEdge = true;
            }
          }
        }
        
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        
        if (isThreatEdge) {
          ctx.strokeStyle = '#f87171';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([6, 4]);
          ctx.lineDashOffset = -waveOffset * 10;
        } else {
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.2)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      });
      
      // DRAW FLOWING PACKETS
      particles.forEach(p => {
        const edge = edges[p.edgeIndex];
        const fromNode = nodes.find(n => n.id === edge.from);
        const toNode = nodes.find(n => n.id === edge.to);
        if (!fromNode || !toNode) return;
        
        const fx = fromNode.x * w;
        const fy = fromNode.y * h;
        const tx = toNode.x * w;
        const ty = toNode.y * h;
        
        p.progress += p.speed;
        if (p.progress > 1) {
          p.progress = 0;
          p.edgeIndex = Math.floor(Math.random() * edges.length);
        }
        
        const px = fx + (tx - fx) * p.progress;
        const py = fy + (ty - fy) * p.progress;
        
        let isRed = false;
        const activeEdge = edges[p.edgeIndex];
        if (state.injectedAnomaly) {
          if (state.injectedAnomaly === 'spike' || state.injectedAnomaly === 'drop') {
            if ((activeEdge.from === 'pay' && activeEdge.to === 'db') || (activeEdge.from === 'gw' && activeEdge.to === 'pay')) {
              isRed = true;
            }
          } else if (state.injectedAnomaly === 'drift') {
            if ((activeEdge.from === 'gw' && activeEdge.to === 'auth')) {
              isRed = true;
            }
          }
        }
        
        ctx.beginPath();
        ctx.arc(px, py, isRed ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = isRed ? '#ef4444' : '#10b981';
        ctx.shadowColor = isRed ? '#ef4444' : '#10b981';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      });
      
      // DRAW NODES
      nodes.forEach(n => {
        const nx = n.x * w;
        const ny = n.y * h;
        
        const pulse = 1 + Math.sin(Date.now() / 250) * 0.12;
        const isAnom = n.status === 'anomalous';
        const isWarn = n.status === 'warning';
        
        ctx.beginPath();
        ctx.arc(nx, ny, 26 * pulse, 0, Math.PI * 2);
        if (isAnom) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
        } else if (isWarn) {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.2)';
        } else {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.04)';
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.12)';
        }
        ctx.fill();
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(nx, ny, 18, 0, Math.PI * 2);
        if (isAnom) {
          ctx.strokeStyle = '#ef4444';
          ctx.fillStyle = '#1f1315';
        } else if (isWarn) {
          ctx.strokeStyle = '#f59e0b';
          ctx.fillStyle = '#241a12';
        } else {
          ctx.strokeStyle = '#10b981';
          ctx.fillStyle = '#0c1a17';
        }
        ctx.lineWidth = 2.5;
        ctx.fill();
        ctx.stroke();
        
        ctx.beginPath();
        ctx.fillStyle = isAnom ? '#f87171' : isWarn ? '#fbbf24' : '#34d399';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        let codeSymbol = 'S';
        if (n.id === 'lb') codeSymbol = 'LB';
        if (n.id === 'gw') codeSymbol = 'GW';
        if (n.id === 'auth') codeSymbol = 'AU';
        if (n.id === 'pay') codeSymbol = 'PY';
        if (n.id === 'db') codeSymbol = 'DB';
        ctx.fillText(codeSymbol, nx, ny);
        
        ctx.fillStyle = '#f3f4f6';
        ctx.font = '600 12px "Outfit", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(n.name, nx, ny + 34);
        
        ctx.fillStyle = '#9ca3af';
        ctx.font = '10px "Outfit", sans-serif';
        ctx.fillText(`${n.val.toFixed(1)} ${n.unit}`, nx, ny + 46);
        
        if (n.risk > 0) {
          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 10px "Outfit", sans-serif';
          ctx.fillText(`Risk: ${n.risk.toFixed(0)}%`, nx, ny - 28);
        }
      });
      
      // HUD OVERLAY BLOCK
      ctx.fillStyle = 'rgba(11, 15, 25, 0.85)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      
      const hudX = 15;
      const hudY = 15;
      const hudW = 280;
      const hudH = 110;
      
      ctx.beginPath();
      ctx.roundRect(hudX, hudY, hudW, hudH, 6);
      ctx.fill();
      ctx.stroke();
      
      ctx.fillStyle = '#a78bfa';
      ctx.font = 'bold 11px "Outfit", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('VERTEX AI GNN INFERENCE PIPELINE', hudX + 12, hudY + 20);
      
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px "Outfit", sans-serif';
      ctx.fillText('Model: PyG Graph Convolutional Net (GCN)', hudX + 12, hudY + 38);
      ctx.fillText('Dataset: telemetry_graph (BigQuery Graph)', hudX + 12, hudY + 52);
      ctx.fillText('Embedding Dim: 16 | Latency: 1.2ms', hudX + 12, hudY + 66);
      
      if (state.injectedAnomaly) {
        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillText('STATUS: CASCADING FAILURE PROPAGATION', hudX + 12, hudY + 88);
      } else {
        ctx.fillStyle = '#34d399';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillText('STATUS: INFERENCE NOMINAL (ALL HEALTHY)', hudX + 12, hudY + 88);
      }
      
      state.gnnAnimationId = requestAnimationFrame(animate);
    }
    
    state.gnnAnimationId = requestAnimationFrame(animate);
  }

  // --- CHART RENDERING SYSTEM ---
  function updateChart(modelingResult, key) {
    // Cancel any active GNN animation loop first
    if (state.gnnAnimationId) {
      cancelAnimationFrame(state.gnnAnimationId);
      state.gnnAnimationId = null;
    }

    if (key === 'gnn_topology') {
      if (state.chart) {
        state.chart.destroy();
        state.chart = null;
      }
      drawTopologyNetwork();
      return;
    }

    const ctx = document.getElementById('telemetry-chart').getContext('2d');
    const meta = datasetMeta[key];

    // Destructure modeling result
    const hist = modelingResult.historical;
    const anoms = modelingResult.anomalies;
    const fMean = modelingResult.forecastMean;
    const fUpper = modelingResult.forecastUpper;
    const fLower = modelingResult.forecastLower;

    // Create Labels
    // Historical: Day 1 to Day 30
    // Forecast: Day 31 to Day 30 + horizon
    const labels = [];
    for (let i = 1; i <= hist.length; i++) {
      labels.push(`Day ${i}`);
    }
    for (let i = 1; i <= state.horizon; i++) {
      labels.push(`Day ${hist.length + i} (F)`);
    }

    // Build Historical series (null in forecast region)
    const histSeries = [...hist];
    for (let i = 0; i < state.horizon; i++) {
      histSeries.push(null);
    }

    // Build Forecast mean series (null in history, but starts at last historical point for smooth transition)
    const forecastSeries = Array(hist.length - 1).fill(null);
    forecastSeries.push(hist[hist.length - 1]); // transition point
    forecastSeries.push(...fMean);

    // Build Upper confidence band
    const upperSeries = Array(hist.length - 1).fill(null);
    upperSeries.push(hist[hist.length - 1]);
    upperSeries.push(...fUpper);

    // Build Lower confidence band
    const lowerSeries = Array(hist.length - 1).fill(null);
    lowerSeries.push(hist[hist.length - 1]);
    lowerSeries.push(...fLower);

    // Build Anomaly points layer (null everywhere else)
    const anomalySeries = Array(hist.length).fill(null);
    anoms.forEach(a => {
      anomalySeries[a.index] = a.value;
    });
    for (let i = 0; i < state.horizon; i++) {
      anomalySeries.push(null);
    }

    // Chart.js data configuration
    const chartData = {
      labels: labels,
      datasets: [
        {
          label: 'Anomaly (Outliers)',
          data: anomalySeries,
          borderColor: '#ef4444',
          backgroundColor: '#ef4444',
          pointRadius: 6,
          pointHoverRadius: 8,
          showLine: false,
          zIndex: 10
        },
        {
          label: 'Historical Metric',
          data: histSeries,
          borderColor: '#10b981',
          backgroundColor: 'transparent',
          borderWidth: 3,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.1,
          zIndex: 5
        },
        {
          label: 'Forecast Trend',
          data: forecastSeries,
          borderColor: '#a78bfa',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          borderDash: [6, 4],
          pointRadius: 0,
          tension: 0.1,
          zIndex: 4
        },
        {
          label: 'Prediction Interval (Upper)',
          data: upperSeries,
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          pointRadius: 0,
          showLine: true,
          fill: '+1', // Fill to lower series
          zIndex: 1
        },
        {
          label: 'Prediction Interval (Lower / Translucent Band)',
          data: lowerSeries,
          borderColor: 'transparent',
          backgroundColor: 'rgba(139, 92, 246, 0.08)', // Beautiful translucent violet
          pointRadius: 0,
          showLine: true,
          fill: '-1', // Fill from upper series
          zIndex: 1
        }
      ]
    };

    // If chart already exists, destroy it before rendering a new one
    if (state.chart) {
      state.chart.destroy();
    }

    // Initialize Chart
    state.chart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#9ca3af',
              font: { family: 'Outfit', size: 12 },
              filter: (legendItem) => {
                // Filter out the filler dataset legends to keep it clean
                return legendItem.text !== 'Prediction Interval (Upper)';
              }
            }
          },
          tooltip: {
            backgroundColor: '#0d1321',
            titleColor: '#ffffff',
            bodyColor: '#f3f4f6',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleFont: { family: 'Outfit', weight: 'bold' },
            bodyFont: { family: 'Outfit' },
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label.includes('Translucent Band')) label = 'Confidence Bounds';
                if (context.parsed.y !== null) {
                  return `${label}: ${context.parsed.y.toFixed(1)}${meta.unit}`;
                }
                return null;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.03)' },
            ticks: { color: '#9ca3af', font: { family: 'Outfit', size: 11 } }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.03)' },
            ticks: { color: '#9ca3af', font: { family: 'Outfit', size: 11 } },
            suggestedMin: meta.min,
            suggestedMax: meta.max
          }
        }
      }
    });
  }

  // --- STATS RECALCULATOR & SCREEN UPDATER ---
  function updateMetadataDisplay(result, key) {
    const meta = datasetMeta[key];
    
    // Update labels & titles
    document.getElementById('chart-metric-category').textContent = meta.cat;
    
    const activeBadge = document.getElementById('chart-metric-status');
    const miniStatExhLabel = document.getElementById('stat-forecast-exhaustion-label');
    const miniStatExhVal = document.getElementById('stat-exhaustion');

    // Reset standard labels & status indicators
    miniStatExhLabel.textContent = 'Capacity Risk';
    miniStatExhVal.className = 'value status-normal';
    miniStatExhVal.textContent = 'None';
    activeBadge.className = 'badge-status status-normal';
    activeBadge.textContent = 'HEALTHY';

    if (key === 'gnn_topology') {
      document.getElementById('chart-metric-title').textContent = meta.title;
      document.getElementById('stat-current').textContent = "5 Active Nodes";
      document.getElementById('stat-mean').textContent = "5 Edges Linked";
      
      const activeAnomaly = state.injectedAnomaly;
      document.getElementById('stat-forecast').textContent = activeAnomaly ? "Cascade Alarm" : "No Cascade";
      
      miniStatExhLabel.textContent = "GNN Accuracy";
      const modelAccuracy = 98.4 + (state.sensitivity - 99.0) * 0.05;
      miniStatExhVal.textContent = `${modelAccuracy.toFixed(1)}%`;
      
      if (activeAnomaly) {
        activeBadge.className = 'badge-status status-anomalous';
        activeBadge.textContent = 'CASCADING FAILURE';
        miniStatExhVal.className = 'value status-danger';
      } else {
        activeBadge.className = 'badge-status status-normal';
        activeBadge.textContent = 'HEALTHY';
        miniStatExhVal.className = 'value status-normal';
      }
      return;
    }

    document.getElementById('chart-metric-title').textContent = `${meta.title} Anomaly Detection`;

    // Mini Stats cards updates
    document.getElementById('stat-current').textContent = `${result.current.toFixed(1)}${meta.unit}`;
    document.getElementById('stat-mean').textContent = `${result.mean.toFixed(1)}${meta.unit}`;
    
    const lastForecast = result.forecastMean[result.forecastMean.length - 1];
    document.getElementById('stat-forecast').textContent = `${lastForecast.toFixed(1)}${meta.unit}`;

    // Exhaustion stats and alerts

    // If capacity disk/memory metrics
    if (meta.isCapacity) {
      miniStatExhLabel.textContent = 'Days to Exhaustion';
      const slope = (lastForecast - result.current) / state.horizon;
      if (slope > 0) {
        const capacityRemaining = meta.max - result.current;
        const daysToExhaust = capacityRemaining / slope;
        
        if (daysToExhaust <= 7) {
          miniStatExhVal.className = 'value status-danger';
          miniStatExhVal.textContent = `${daysToExhaust.toFixed(1)} Days`;
          activeBadge.className = 'badge-status status-anomalous';
          activeBadge.textContent = 'CAPACITY ALERT';
        } else if (daysToExhaust <= 20) {
          miniStatExhVal.className = 'value status-warning';
          miniStatExhVal.textContent = `${daysToExhaust.toFixed(1)} Days`;
          activeBadge.className = 'badge-status status-warning';
          activeBadge.textContent = 'PREDICTIVE ALERT';
        } else {
          miniStatExhVal.textContent = `${daysToExhaust.toFixed(1)} Days`;
        }
      } else {
        miniStatExhVal.textContent = 'Infinite';
      }
    } else {
      // General anomalies
      if (result.anomalies.length > 0) {
        const lastAnomaly = result.anomalies[result.anomalies.length - 1];
        // If an anomaly is at the end, flag it active!
        if (lastAnomaly.index >= result.historical.length - 2) {
          activeBadge.className = 'badge-status status-anomalous';
          activeBadge.textContent = 'ANOMALOUS';
          miniStatExhVal.className = 'value status-danger';
          miniStatExhVal.textContent = 'Outlier';
        } else {
          miniStatExhVal.textContent = 'Historical Outliers';
          miniStatExhVal.className = 'value status-warning';
        }
      } else {
        miniStatExhVal.textContent = 'Healthy';
      }
    }
  }

  // --- BLUEPRINT TABS SWITCHER ---
  let activeBpTab = 'bqml';
  function updateBlueprintsCode() {
    const codeDisplay = document.getElementById('blueprint-code-display');
    if (codeDisplay) {
      const bptemplate = blueprints[state.selectedDataset]?.[activeBpTab];
      codeDisplay.textContent = bptemplate || '-- No template configured for this selection';
    }
  }

  const bpTabs = document.querySelectorAll('.blueprint-tab');
  bpTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      bpTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeBpTab = tab.getAttribute('data-bptab');
      updateBlueprintsCode();
    });
  });

  // --- CORE CHART RE-RENDER TRIGGER ---
  function triggerRendering() {
    const modelingResult = computeModeling(state.selectedDataset);
    updateChart(modelingResult, state.selectedDataset);
    updateMetadataDisplay(modelingResult, state.selectedDataset);
    updateBlueprintsCode();
    refreshOverviewTable();
  }

  // --- EVENT LISTENERS FOR CONTROLS ---
  // Dataset Select
  const datasetSelector = document.getElementById('dataset-selector');
  if (datasetSelector) {
    datasetSelector.addEventListener('change', (e) => {
      state.selectedDataset = e.target.value;
      state.injectedAnomaly = null; // reset injections on swap
      addLog('info', `Swapped workspace playground target stream to ${datasetMeta[state.selectedDataset].title}.`);
      triggerRendering();
    });
  }

  // Sensitivity Slider
  const sensSlider = document.getElementById('slider-sensitivity');
  const sensVal = document.getElementById('sensitivity-val');
  if (sensSlider) {
    sensSlider.addEventListener('input', (e) => {
      state.sensitivity = parseFloat(e.target.value);
      sensVal.textContent = `${state.sensitivity}%`;
      triggerRendering();
    });
  }

  // Horizon Slider
  const horizonSlider = document.getElementById('slider-horizon');
  const horizonVal = document.getElementById('horizon-val');
  if (horizonSlider) {
    horizonSlider.addEventListener('input', (e) => {
      state.horizon = parseInt(e.target.value);
      horizonVal.textContent = `${state.horizon} Days`;
      triggerRendering();
    });
  }

  // Injection buttons
  const injectSpikeBtn = document.getElementById('inject-spike-btn');
  const injectDropBtn = document.getElementById('inject-drop-btn');
  const injectDriftBtn = document.getElementById('inject-drift-btn');

  if (injectSpikeBtn) {
    injectSpikeBtn.addEventListener('click', () => {
      state.injectedAnomaly = 'spike';
      addLog('anomaly', `CRITICAL: Simulated OUTLIER injected on ${datasetMeta[state.selectedDataset].title}. Triggering BigQuery ML detection alerts.`);
      triggerRendering();
    });
  }

  if (injectDropBtn) {
    injectDropBtn.addEventListener('click', () => {
      state.injectedAnomaly = 'drop';
      addLog('anomaly', `CRITICAL: Simulated CRASH drop injected on ${datasetMeta[state.selectedDataset].title}. Cloud Monitoring agent flags process failure.`);
      triggerRendering();
    });
  }

  if (injectDriftBtn) {
    injectDriftBtn.addEventListener('click', () => {
      state.injectedAnomaly = 'drift';
      addLog('warning', `WARNING: Simulated STEP CHANGE / DRIFT injected on ${datasetMeta[state.selectedDataset].title}. Alerting policy monitoring mean adjustments.`);
      triggerRendering();
    });
  }

  // Copy code to clipboard
  const copyBtn = document.getElementById('copy-blueprint-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const code = document.getElementById('blueprint-code-display').textContent;
      navigator.clipboard.writeText(code).then(() => {
        const origText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i data-lucide="check"></i> <span>Copied!</span>';
        lucide.createIcons();
        setTimeout(() => {
          copyBtn.innerHTML = origText;
          lucide.createIcons();
        }, 1500);
      });
    });
  }

  // Clear logs console
  const clearLogsBtn = document.getElementById('clear-logs-btn');
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', () => {
      state.logs = [];
      if (logConsole) logConsole.innerHTML = '';
      addLog('info', 'Anomaly logs buffer cleared.');
    });
  }

  // --- OVERVIEW DASHBOARD STREAM TABLE ---
  function getMetricRowHtml(key) {
    const meta = datasetMeta[key];
    const modelRes = computeModeling(key);
    
    let sourceClass = 'source-prometheus';
    if (meta.cat === 'ServiceNow Logs') sourceClass = 'source-logging';
    if (meta.cat === 'Capacity Trends') sourceClass = 'source-capacity';
    if (meta.cat === 'Graph Neural Networks') sourceClass = 'source-gnn';
    if (meta.cat === 'Unified Telemetry Correlation') sourceClass = 'source-correlation';

    let algo = 'ARIMA_PLUS';
    if (key === 'cpu') algo = 'Monarch Predict';
    if (meta.cat === 'Google Managed Prometheus') algo = 'PromQL forecast';
    if (meta.cat === 'Graph Neural Networks') algo = 'Vertex AI PyG';
    if (key === 'logs_metrics_correlation') algo = 'SQL FULL JOIN';

    // Status pill
    let statusPill = '<span class="status-pill status-healthy"><i data-lucide="check-circle-2"></i> Healthy</span>';
    let displayValue = `${modelRes.current.toFixed(1)}${meta.unit}`;
    
    if (key === 'gnn_topology') {
      const activeAnomaly = state.injectedAnomaly;
      displayValue = activeAnomaly ? "Cascade" : "Healthy";
      if (activeAnomaly) {
        statusPill = '<span class="status-pill status-anomalous"><i data-lucide="zap"></i> Cascade Alert</span>';
      } else {
        statusPill = '<span class="status-pill status-healthy"><i data-lucide="check-circle-2"></i> Nominal</span>';
      }
    } else if (meta.isCapacity) {
      const lastForecast = modelRes.forecastMean[modelRes.forecastMean.length - 1];
      const slope = (lastForecast - modelRes.current) / state.horizon;
      if (slope > 0) {
        const daysToExhaust = (meta.max - modelRes.current) / slope;
        if (daysToExhaust <= 7) {
          statusPill = '<span class="status-pill status-anomalous"><i data-lucide="alert-octagon"></i> Exh < 7d</span>';
        } else if (daysToExhaust <= 20) {
          statusPill = '<span class="status-pill status-warning"><i data-lucide="alert-triangle"></i> Exh < 20d</span>';
        }
      }
    } else {
      if (modelRes.anomalies.length > 0) {
        const lastAnomaly = modelRes.anomalies[modelRes.anomalies.length - 1];
        if (lastAnomaly.index >= modelRes.historical.length - 2) {
          statusPill = '<span class="status-pill status-anomalous"><i data-lucide="zap"></i> Outlier</span>';
        }
      }
    }

    return `
      <tr data-targetkey="${key}">
        <td class="metric-name-cell">${meta.title}</td>
        <td><span class="metric-source-badge ${sourceClass}">${meta.cat}</span></td>
        <td class="metric-algo">${algo}</td>
        <td class="metric-value-cell font-mono">${displayValue}</td>
        <td>${statusPill}</td>
      </tr>
    `;
  }

  function refreshOverviewTable() {
    const tbody = document.getElementById('overview-telemetry-tbody');
    if (!tbody) return;

    let rowsHtml = '';
    Object.keys(datasetMeta).forEach(key => {
      rowsHtml += getMetricRowHtml(key);
    });
    tbody.innerHTML = rowsHtml;

    // Attach click events to rows to switch to sandbox for exploration
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
      row.addEventListener('click', () => {
        const key = row.getAttribute('data-targetkey');
        state.selectedDataset = key;
        
        // Select in dropdown
        if (datasetSelector) datasetSelector.value = key;

        // Transition to sandbox tab
        switchTab('sandbox');
      });
    });

    // Recalculate metrics totals for overview stats
    let totalAnoms = 0;
    let totalForecasts = 0;

    Object.keys(datasetMeta).forEach(key => {
      const m = datasetMeta[key];
      const res = computeModeling(key);
      if (m.isCapacity) {
        const lastForecast = res.forecastMean[res.forecastMean.length - 1];
        const slope = (lastForecast - res.current) / state.horizon;
        if (slope > 0) {
          const daysToExhaust = (m.max - res.current) / slope;
          if (daysToExhaust <= 20) totalForecasts++;
        }
      } else {
        if (res.anomalies.length > 0) {
          const lastAnomaly = res.anomalies[res.anomalies.length - 1];
          if (lastAnomaly.index >= res.historical.length - 2) totalAnoms++;
        }
      }
    });

    document.getElementById('active-anomalies-count').textContent = totalAnoms;
    document.getElementById('active-forecasts-count').textContent = totalForecasts;

    const anomalyBadgeWrapper = document.getElementById('anomaly-badge-wrapper');
    const anomalyTrendIndicator = document.getElementById('anomaly-trend-indicator');
    const anomalyTrendLabel = document.getElementById('anomaly-trend-label');

    if (totalAnoms > 0) {
      anomalyBadgeWrapper.className = 'stat-icon-wrapper warning pulsing';
      anomalyTrendIndicator.className = 'trend negative';
      anomalyTrendIndicator.innerHTML = '<i data-lucide="arrow-up-right"></i> Outlier Detected';
      anomalyTrendLabel.textContent = 'Simulated incident anomaly flagged.';
    } else {
      anomalyBadgeWrapper.className = 'stat-icon-wrapper normal';
      anomalyTrendIndicator.className = 'trend positive';
      anomalyTrendIndicator.innerHTML = '<i data-lucide="check-circle-2"></i> All Clear';
      anomalyTrendLabel.textContent = 'No active telemetry outliers.';
    }

    lucide.createIcons();
  }

  // --- TAB SWITCHER LOGIC ---
  function switchTab(tabId) {
    state.activeTab = tabId;

    // Remove active class from menu items & contents
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.remove('active');
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      }
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });

    const activeContent = document.getElementById(`tab-${tabId}`);
    if (activeContent) {
      activeContent.classList.add('active');
    }

    // Set page headers
    const titleEl = document.getElementById('page-title');
    const subtitleEl = document.getElementById('page-subtitle');

    switch (tabId) {
      case 'overview':
        titleEl.textContent = 'Overview Dashboard';
        subtitleEl.textContent = 'Real-time telemetry forecasting, machine learning, and anomaly detection control center.';
        break;
      case 'sandbox':
        titleEl.textContent = 'Telemetry Playground Sandbox';
        subtitleEl.textContent = 'Simulate anomalies, tune ARIMA_PLUS parameters, and extract GCP native alerting code.';
        break;
      case 'playbook':
        titleEl.textContent = 'GCP Implementation Playbook';
        subtitleEl.textContent = 'Step-by-step technical architecture guide to deploy anomaly detection in gke-demos-363017.';
        break;
      case 'migration':
        titleEl.textContent = 'ELK Stack to GCP Migration map';
        subtitleEl.textContent = 'Mapping Kibana ML, Logstash pipelines, and Elasticsearch indexes to serverless GCP alternatives.';
        break;
    }

    // Chart.js requires resizing on display swap
    if (tabId === 'sandbox') {
      triggerRendering();
    } else {
      refreshOverviewTable();
    }
    
    lucide.createIcons();
  }

  const menuBtns = document.querySelectorAll('.nav-item');
  menuBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // --- INTRADAY AUTO-LOG EMULATOR ---
  // To make the interface feel alive, append logs dynamically every 15 seconds
  const sampleLogs = [
    { type: 'info', msg: 'Cloud Monitoring successfully evaluated PromQL rule "CPU_Exhaustion_forecast_4h". Status: healthy.' },
    { type: 'info', msg: 'BigQuery ML scheduled model retrain completed on table "servicenow_logs.incidents_daily".' },
    { type: 'warning', msg: 'GKE node node-pool-gcp-02 memory paging rates climbing. Trend shows 5.2% daily growth.' },
    { type: 'info', msg: 'Monarch timeseries read request: project=gke-demos-363017, metric=node_filesystem_free_bytes, points=1440.' },
    { type: 'info', msg: 'Cloud Logging Log Analytics query executed: SELECT COUNT(1) FROM default_dataset._AllLogs.' },
    { type: 'info', msg: 'Google Managed Prometheus scraped 25 k8s cluster endpoints in 124ms.' }
  ];

  setInterval(() => {
    const randomLog = sampleLogs[Math.floor(Math.random() * sampleLogs.length)];
    // Sometimes random warnings are anomalies, but normally info
    addLog(randomLog.type, randomLog.msg);
    refreshOverviewTable();
  }, 16000);

  // --- INITIAL TRIGGER ---
  triggerRendering();
  refreshOverviewTable();
});
