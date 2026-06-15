#!/usr/bin/env python3
"""
Production GNN Training Script

This script downloads topology from BigQuery, queries active telemetry features,
constructs PyTorch Geometric graph data structures, trains the GCN, and saves model weights.
Features (4-dimensional):
  1. cpu_util: CPU utilization percentage (0.0 to 1.0)
  2. throughput_ratio: Actual throughput / expected throughput (1.0 is nominal, 0.0 is hung/starved)
  3. network_socket_exhaustion: Ratio of active TCP sockets to system limits (0.0 to 1.0)
  4. db_connectivity_error_rate: Percentage of database connections failing (0.0 to 1.0)
"""

import argparse
import os
import json
import sys
import torch
import torch.nn as nn
from google.cloud import bigquery
from model import GNNTopologyCascadePredictor

torch.manual_seed(42)

def parse_args():
    parser = argparse.ArgumentParser(description="Train topological GNN on GCP observability data.")
    parser.add_argument("--project_id", required=True, help="The GCP Project ID.")
    parser.add_argument("--dataset_id", default="observability_ml", help="BigQuery dataset containing topology tables.")
    parser.add_argument("--metrics_dataset", default="monitoring_export", help="BigQuery dataset containing metrics export.")
    parser.add_argument("--logs_dataset", default="global._Default", help="Log Analytics linked dataset.")
    parser.add_argument("--local_dry_run", action="store_true", 
                        help="Train model using synthetic features over graph layout (bypasses live GCP telemetry queries).")
    return parser.parse_args()

def fetch_graph_structure(client, project_id, dataset_id):
    """Fetches nodes and edges from BigQuery graph tables."""
    print("Fetching active topology from BigQuery...")
    
    # Query nodes
    nodes_query = f"SELECT node_id, node_name, service_type FROM `{project_id}.{dataset_id}.graph_nodes` ORDER BY node_id"
    nodes_df = client.query(nodes_query).to_dataframe()
    
    # Query edges
    edges_query = f"SELECT source_id, destination_id FROM `{project_id}.{dataset_id}.graph_edges`"
    edges_df = client.query(edges_query).to_dataframe()
    
    if nodes_df.empty:
        print("⚠ The graph_nodes table is empty. Please run extract_topology.py first.")
        sys.exit(1)
        
    return nodes_df, edges_df

def build_training_scenarios(node_mapping, edge_index):
    """
    Synthesizes historical incidents to teach the GNN how specific failures cascade.
    We create three distinct training scenarios based on slide use cases.
    Features: [cpu_util, throughput_ratio, network_socket_exhaustion, db_connectivity_error_rate]
    """
    scenarios = []
    num_nodes = len(node_mapping)
    
    # Resolve node indexes
    util_idx = None
    app_idx = None
    db_idx = None
    lb_idx = None
    
    for nid, name in node_mapping.items():
        if "utility" in name:
            util_idx = int(nid)
        elif "application" in name:
            app_idx = int(nid)
        elif "00008" in name or "db" in name or "database" in name:
            db_idx = int(nid)
        elif "lb" in name or "gateway" in name:
            lb_idx = int(nid)
            
    # Set default values if node names aren't matched
    util_idx = util_idx if util_idx is not None else 0
    app_idx = app_idx if app_idx is not None else 1
    db_idx = db_idx if db_idx is not None else 2
    lb_idx = lb_idx if lb_idx is not None else 3

    # --------------------------------------------------------------------------
    # Scenario 1: Nominal State (Everything healthy)
    # Features: [CPU, Throughput_Ratio, Socket_Exhaustion, DB_Errors]
    # --------------------------------------------------------------------------
    x_nominal = torch.tensor([[0.15, 1.00, 0.20, 0.00] for _ in range(num_nodes)], dtype=torch.float)
    y_nominal = torch.tensor([[0.00] for _ in range(num_nodes)], dtype=torch.float)
    scenarios.append((x_nominal, y_nominal))

    # --------------------------------------------------------------------------
    # Scenario 2: Server Unresponsive Hang (CPU Spike with No Throughput on Utility)
    # Node 0 (utility) hangs due to thread starvation and socket exhaustion.
    # --------------------------------------------------------------------------
    x_hang = torch.tensor([[0.15, 1.00, 0.20, 0.00] for _ in range(num_nodes)], dtype=torch.float)
    # Utility server: 98% CPU, 0.0 throughput ratio, 99% socket exhaustion, 0.0 DB errors
    x_hang[util_idx] = torch.tensor([0.98, 0.00, 0.99, 0.00])
    
    # Expected cascade risks: Utility has 100% risk, LB (dependent) has 75% risk.
    y_hang = torch.tensor([[0.00] for _ in range(num_nodes)], dtype=torch.float)
    y_hang[util_idx] = torch.tensor([1.00])
    y_hang[lb_idx] = torch.tensor([0.75])
    scenarios.append((x_hang, y_hang))

    # --------------------------------------------------------------------------
    # Scenario 3: Database Connectivity Failure (Epicenter ZEBOSDWN00008)
    # Node 2 (database) degraded -> Node 1 (app server) fails DB connections -> Node 0 degrades.
    # --------------------------------------------------------------------------
    x_db_fail = torch.tensor([[0.15, 1.00, 0.20, 0.00] for _ in range(num_nodes)], dtype=torch.float)
    # Database: High CPU, high error rate
    x_db_fail[db_idx] = torch.tensor([0.90, 0.50, 0.30, 0.85])
    # App Server: Experiences high DB connection errors
    x_db_fail[app_idx] = torch.tensor([0.75, 0.30, 0.40, 0.95])
    # Utility Server: Latency cascades, throughput drops
    x_db_fail[util_idx] = torch.tensor([0.50, 0.15, 0.60, 0.00])
    
    # Expected cascade risks
    y_db_fail = torch.tensor([[0.00] for _ in range(num_nodes)], dtype=torch.float)
    y_db_fail[db_idx] = torch.tensor([1.00])
    y_db_fail[app_idx] = torch.tensor([0.95])
    y_db_fail[util_idx] = torch.tensor([0.75])
    y_db_fail[lb_idx] = torch.tensor([0.40])
    scenarios.append((x_db_fail, y_db_fail))

    return scenarios

def build_features_and_labels(client, project_id, dataset_id, metrics_dataset, logs_dataset, nodes_df, edges_df, local_dry_run):
    """
    Retrieves real CPU, Throughput, Socket counts, and DB error metrics for each node from BigQuery.
    """
    num_nodes = len(nodes_df)
    node_mapping = dict(zip(nodes_df["node_name"], nodes_df["node_id"]))
    
    # Initialize default features matrix
    x = torch.zeros((num_nodes, 4), dtype=torch.float)
    y = torch.zeros((num_nodes, 1), dtype=torch.float)
    
    # Construct edge_index
    if not edges_df.empty:
        edge_sources = torch.tensor(edges_df["source_id"].values, dtype=torch.long)
        edge_dests = torch.tensor(edges_df["destination_id"].values, dtype=torch.long)
        edges = torch.stack([edge_sources, edge_dests], dim=0) # [2, num_edges]
        edge_index = torch.cat([edges, edges.flip(0)], dim=1)
    else:
        edge_index = torch.zeros((2, 0), dtype=torch.long)

    if local_dry_run:
        print("Using synthetic training scenarios for the server responsive and database failure models...")
        # Handled in build_training_scenarios
        return None, edge_index, None

    print("Fetching active telemetry features from BigQuery tables...")
    try:
        # Complex join querying actual CPU, requests count (throughput), network connections, and log errors
        features_query = f"""
        WITH cpu_metrics AS (
          SELECT
            COALESCE(resource.labels.container_name, resource.labels.job) AS service,
            AVG(point.value.double_value) AS avg_cpu
          FROM `{project_id}.{metrics_dataset}.time_series`
          WHERE metric.type = 'kubernetes.io/container/cpu/limit_utilization'
            AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
          GROUP BY 1
        ),
        
        throughput_metrics AS (
          SELECT
            COALESCE(resource.labels.container_name, resource.labels.job) AS service,
            # Ratio of current request rate to nominal average baseline
            SAFE_DIVIDE(AVG(point.value.double_value), 100.0) AS throughput_val
          FROM `{project_id}.{metrics_dataset}.time_series`
          WHERE metric.type LIKE '%requests%'
            AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
          GROUP BY 1
        ),
        
        socket_metrics AS (
          SELECT
            COALESCE(resource.labels.container_name, resource.labels.job) AS service,
            AVG(point.value.double_value) AS socket_exhaustion
          FROM `{project_id}.{metrics_dataset}.time_series`
          WHERE metric.type LIKE '%sockets%' OR metric.type LIKE '%connections%'
            AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
          GROUP BY 1
        ),
        
        db_errors AS (
          SELECT
            COALESCE(JSON_VALUE(resource.labels.container_name), 'unknown') AS service,
            SAFE_DIVIDE(COUNTIF(severity >= 'WARNING' AND (textPayload LIKE '%Connection%' OR textPayload LIKE '%SQL%')), COUNT(1)) AS db_err_rate
          FROM `{project_id}.{logs_dataset}._AllLogs`
          WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
          GROUP BY 1
        )
        
        SELECT
          n.node_id,
          n.node_name,
          COALESCE(cpu.cpu_val, 0.15) AS cpu_val,
          COALESCE(t.throughput_val, 1.00) AS throughput_val,
          COALESCE(sock.socket_exhaustion, 0.20) AS socket_val,
          COALESCE(dbe.db_err_rate, 0.00) AS db_err_val
        FROM `{project_id}.{dataset_id}.graph_nodes` n
        LEFT JOIN cpu_metrics cpu ON n.node_name = cpu.service
        LEFT JOIN throughput_metrics t ON n.node_name = t.service
        LEFT JOIN socket_metrics sock ON n.node_name = sock.service
        LEFT JOIN db_errors dbe ON n.node_name = dbe.service
        """
        
        features_df = client.query(features_query).to_dataframe()
        
        # Populate tensor
        for _, row in features_df.iterrows():
            nid = int(row["node_id"])
            cpu = float(row["cpu_val"])
            tpt = float(row["throughput_val"])
            sock = float(row["socket_val"])
            dbe = float(row["db_err_val"])
            
            x[nid] = torch.tensor([cpu, tpt, sock, dbe])
            
            # Simple heuristic target label: high CPU + low throughput -> unresponsive (risk 1.0)
            # High DB error rate -> connection degradation (risk 0.95)
            risk = 0.0
            if (cpu > 0.85 and tpt < 0.2) or sock > 0.9:
                risk = 1.0
            elif dbe > 0.5:
                risk = 0.9
            y[nid] = torch.tensor([risk])
            
        print("✓ Live features compiled.")
        return x, edge_index, y
        
    except Exception as e:
        print(f"⚠ Live feature compilation failed: {e}. Defaulting to synthetic data scenarios.")
        return None, edge_index, None

def main():
    args = parse_args()
    
    if args.local_dry_run:
        print("Running in LOCAL DRY RUN mode. Constructing mock service topology...")
        import pandas as pd
        nodes_df = pd.DataFrame([
            {"node_id": 0, "node_name": "zebosawn00141-utility", "service_type": "utility"},
            {"node_id": 1, "node_name": "zebosawn00140-application", "service_type": "app_server"},
            {"node_id": 2, "node_name": "ZEBOSDWN00008", "service_type": "database"},
            {"node_id": 3, "node_name": "ingress-lb", "service_type": "gateway"}
        ])
        edges_df = pd.DataFrame([
            {"source_id": 3, "destination_id": 0},
            {"source_id": 0, "destination_id": 1},
            {"source_id": 1, "destination_id": 2}
        ])
    else:
        client = bigquery.Client(project=args.project_id)
        # 1. Load topology
        nodes_df, edges_df = fetch_graph_structure(client, args.project_id, args.dataset_id)
        
    node_mapping = dict(zip(nodes_df["node_id"].astype(str), nodes_df["node_name"]))
    
    # 2. Get edge index
    x_live, edge_index, y_live = build_features_and_labels(
        None if args.local_dry_run else client, 
        args.project_id, args.dataset_id, args.metrics_dataset, args.logs_dataset, 
        nodes_df, edges_df, args.local_dry_run
    )
    
    # 3. Create scenarios
    scenarios = build_training_scenarios(node_mapping, edge_index)
    if x_live is not None and y_live is not None:
        scenarios.append((x_live, y_live))
        print(f"Added live telemetry snapshot to training datasets.")
        
    # 4. Instantiate GNN Model (4 input features)
    model = GNNTopologyCascadePredictor(num_node_features=4, hidden_dim=16)
    
    # 5. Train model
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01, weight_decay=1e-4)
    criterion = nn.BCELoss()
    
    epochs = 300
    model.train()
    print(f"Training topological GNN for {epochs} epochs over {len(scenarios)} incident scenarios...")
    
    for epoch in range(1, epochs + 1):
        epoch_loss = 0.0
        optimizer.zero_grad()
        
        for sx, sy in scenarios:
            pred = model(sx, edge_index)
            loss = criterion(pred, sy)
            loss.backward()
            epoch_loss += loss.item()
            
        optimizer.step()
        
        if epoch % 50 == 0 or epoch == 1:
            print(f"Epoch {epoch:03d}/{epochs} | Cumulative Scenario Loss: {epoch_loss:.6f}")
            
    # 6. Evaluate DB fail cascade scenario
    model.eval()
    with torch.no_grad():
        print("\nTraining completed! Evaluating final failure cascade predictions:")
        test_x, test_y = scenarios[-1] # Evaluate on latest scenario
        predictions = model(test_x, edge_index)
        
        for idx in range(len(nodes_df)):
            name = node_mapping.get(str(idx), f"service-{idx}")
            true_risk = test_y[idx].item() * 100
            pred_risk = predictions[idx].item() * 100
            print(f" - [{name}] -> True Risk: {true_risk:.1f}% | GNN Predicted Risk: {pred_risk:.1f}%")
            
    # 7. Serialize weights and metadata
    output_dir = "artifacts"
    os.makedirs(output_dir, exist_ok=True)
    
    model_path = os.path.join(output_dir, "model.pt")
    torch.save(model.state_dict(), model_path)
    print(f"\nModel weights saved successfully to: {model_path}")
    
    metadata = {
        "num_node_features": 4,
        "hidden_dim": 16,
        "node_mapping": node_mapping,
        "edge_index": edge_index.tolist()
    }
    meta_path = os.path.join(output_dir, "metadata.json")
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"Metadata configuration saved to: {meta_path}")

if __name__ == "__main__":
    main()
