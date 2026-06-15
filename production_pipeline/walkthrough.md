# Walkthrough: Implementing Production Anomaly Detection & GraphML Use Cases

This document details the configuration and query logic for three specific production anomaly detection use cases:
1. **Server Unresponsive Prediction (Hang / Starvation Detection)**
2. **Server Connectivity Failure & Cascade Prediction (App-DB Outage Propagation)**
3. **Recurring Incident & Reboot Pattern Detection**

---

## ⚡ Use Case 1: Server Unresponsive Prediction

**Objective:** Detect when a server (e.g. `zebosawn00141-utility` or `zebosawn00140-application`) is alive but not responsive to application calls (predicting unresponsiveness 15–30 minutes in advance).

### Key Indicators
* **CPU Utilization vs. Throughput:** A server experiencing thread starvation or an OS-level hang will show a massive CPU utilization spike ($>85\%$) but near-zero transaction throughput.
* **Network Socket Exhaustion:** Socket counts or connection pools reach system/process limits.
* **IO Wait & Disk Latency:** Elevated queue length and IO delay values.

### SQL Query Logic (BigQuery View)
The `server_unresponsive_detection_view` computes a custom risk index by correlating interval-based Prometheus metrics:

```sql
SELECT
  timestamp_bucket,
  server_name,
  cpu_util,
  throughput_rate,
  active_connections,
  CASE
    WHEN cpu_util > 0.85 AND throughput_rate < 1000.0 AND active_connections > 500 
      THEN 'CRITICAL: Thread Starvation / OS Hang Risk'
    WHEN cpu_util > 0.80 AND throughput_rate < 5000.0 
      THEN 'WARNING: High CPU / Low Throughput Anomaly'
    ELSE 'NOMINAL'
  END AS unresponsive_risk_state
FROM `${PROJECT_ID}.observability_ml.server_unresponsive_detection_view`;
```

---

## 🔗 Use Case 2: Server Connectivity Failure & Cascade Prediction

**Objective:** Detect App Server $\leftrightarrow$ Database connectivity degradation (packet loss, connection failures) and forecast cascading failure risks across tiers (30–60 minutes in advance).

### Key Indicators
* **Log Signatures:** Logs expressing JDBC connection timeouts, database socket resets, or pool exhaustion.
* **Network Latency:** Packet drop rates and DB response time anomalies.
* **Outage Cascading (Graph Neural Networks):** If `ZEBOSDWN00008` (database server) degrades, the GNN convolving metrics over the dependency topology flags high cascade risks on `zebosawn00140-application` and `zebosawn00141-utility` upstream nodes.

### SQL Query Logic (BigQuery View)
The `connectivity_degradation_view` aggregates database error signatures and ratios from Log Analytics:

```sql
SELECT
  timestamp_bucket,
  service_name,
  db_connection_errors,
  db_error_ratio
FROM `${PROJECT_ID}.observability_ml.connectivity_degradation_view`
WHERE db_error_ratio > 0.10;
```

### Topological GraphML (GNN) Cascade Analysis
The PyTorch GNN (`train_gnn.py` and `serve_gnn.py`) uses a 4-dimensional node feature vector:
`[cpu_util, throughput_ratio, network_socket_exhaustion, db_connectivity_error_rate]`

If a database node (`ZEBOSDWN00008`) is degraded, the GNN convolves features along the topological path (`LB -> utility -> application -> DB`), predicting failure risk propagation:

```python
# Inference response showing cascade risk propagation
{
  "predictions": {
    "ZEBOSDWN00008": {
      "cascade_risk_probability": 1.0000,   # Outage epicenter
      "is_cascade_alert_triggered": true
    },
    "zebosawn00140-application": {
      "cascade_risk_probability": 0.9542,   # Direct dependent (high cascade failure risk)
      "is_cascade_alert_triggered": true
    },
    "zebosawn00141-utility": {
      "cascade_risk_probability": 0.7580,   # Two-hop dependent (elevated failure risk)
      "is_cascade_alert_triggered": true
    },
    "ingress-lb": {
      "cascade_risk_probability": 0.4012,   # Gateway (warning/moderate risk)
      "is_cascade_alert_triggered": false
    }
  }
}
```

---

## 🔄 Use Case 3: Recurring Incident & Reboot Pattern Detection

**Objective:** Identify systemic issues masked by frequent reboots (e.g. rebooting `zebosawn00140` fixes the app temporarily, but the underlying issue resides in database node `ZEBOSDWN00008`).

### Reboot Signature Detection
We query Log Analytics to find restarts (Tomcat boot, Apache start, or instance reboots) and look for recurrent errors on the same or related hosts within 2 hours:

```sql
SELECT
  reboot_time,
  rebooted_server,
  failure_time,
  failing_server,
  failure_message,
  minutes_since_reboot
FROM `${PROJECT_ID}.observability_ml.recurring_incident_patterns_view`
ORDER BY reboot_time DESC;
```

If a server experiences error logs shortly after a reboot event, it flags a `CRITICAL: Reboot fix failed. Systemic issue remains unresolved` recurrence classification, alerting operations to investigate the database backend rather than repeating reboots.

---

## 🛠️ Local Verification & Dry Run

Verify the use cases locally by executing a dry-run GNN training pass:

```bash
# 1. Navigate to the scripts directory
cd production_pipeline/scripts/

# 2. Extract specific topology mapping
python3 extract_topology.py --project_id YOUR_PROJECT_ID --dry_run

# 3. Train the model using the 4-dimensional incident scenarios
python3 train_gnn.py --project_id YOUR_PROJECT_ID --local_dry_run
```
