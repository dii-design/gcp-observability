#!/usr/bin/env python3
"""
Dynamic GNN Topology Extractor

This script connects to BigQuery and queries real application telemetry (either trace span logs
or Prometheus/Istio mesh metrics) to build the active microservice relationship graph (topology).
The results are stored in BigQuery `graph_nodes` and `graph_edges` tables.
"""

import argparse
import sys
from google.cloud import bigquery

def parse_args():
    parser = argparse.ArgumentParser(description="Extract active microservice topology from GCP telemetry.")
    parser.add_argument("--project_id", required=True, help="The GCP Project ID.")
    parser.add_argument("--dataset_id", default="observability_ml", help="BigQuery dataset containing topology tables.")
    parser.add_argument("--logs_dataset", default="global._Default", help="Log Analytics linked dataset (e.g., global._Default).")
    parser.add_argument("--metrics_dataset", default="monitoring_export", help="BigQuery dataset containing metrics export.")
    parser.add_argument("--mode", default="metrics", choices=["logs", "metrics"], 
                        help="Extraction mode: 'logs' (query trace spans) or 'metrics' (query service mesh metrics).")
    parser.add_argument("--dry_run", action="store_true", help="Perform a dry run seeding sample production topology.")
    return parser.parse_args()

def seed_sample_topology(client, project_id, dataset_id):
    """Seeds sample production-like topology data for dry-run/bootstrap testing."""
    print("Running in DRY RUN mode. Seeding sample production topology...")
    
    # 1. Define nodes representing the specific servers from the incidents
    nodes = [
        {"node_id": 0, "node_name": "zebosawn00141-utility", "service_type": "utility"},
        {"node_id": 1, "node_name": "zebosawn00140-application", "service_type": "app_server"},
        {"node_id": 2, "node_name": "ZEBOSDWN00008", "service_type": "database"},
        {"node_id": 3, "node_name": "ingress-lb", "service_type": "gateway"},
    ]
    
    # 2. Define edges (dependency relationships: source relies on destination)
    edges = [
        {"edge_id": 100, "source_id": 3, "destination_id": 0, "dependency_type": "HTTP"}, # LB -> utility
        {"edge_id": 101, "source_id": 0, "destination_id": 1, "dependency_type": "HTTP"}, # utility -> app server
        {"edge_id": 102, "source_id": 1, "destination_id": 2, "dependency_type": "SQL"},  # app server -> DB ZEBOSDWN00008
    ]

    # Write nodes
    nodes_table = f"{project_id}.{dataset_id}.graph_nodes"
    errors = client.insert_rows_json(nodes_table, nodes)
    if errors:
        print(f"Error seeding nodes: {errors}")
        sys.exit(1)
    print(f"✓ Successfully seeded {len(nodes)} nodes to {nodes_table}.")

    # Write edges
    edges_table = f"{project_id}.{dataset_id}.graph_edges"
    errors = client.insert_rows_json(edges_table, edges)
    if errors:
        print(f"Error seeding edges: {errors}")
        sys.exit(1)
    print(f"✓ Successfully seeded {len(edges)} edges to {edges_table}.")

def extract_from_metrics(client, project_id, dataset_id, metrics_dataset):
    """
    Extracts topology edges and nodes from Prometheus/Istio metrics export.
    Uses 'istio_requests_total' metric labels to build the dependency map.
    """
    print(f"Extracting topology from metric export table: {project_id}.{metrics_dataset}.time_series...")
    
    query = f"""
    WITH raw_dependencies AS (
      # Query the continuous export of Istio HTTP/gRPC request metrics
      # filtering for source and destination workloads
      SELECT DISTINCT
        metric.labels.source_workload AS caller,
        metric.labels.destination_workload AS callee,
        metric.labels.destination_service_name AS callee_service_type
      FROM `{project_id}.{metrics_dataset}.time_series`
      WHERE metric.type = 'prometheus.googleapis.com/istio_requests_total/counter'
        AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)
        AND metric.labels.source_workload IS NOT NULL 
        AND metric.labels.destination_workload IS NOT NULL
    ),
    
    all_services AS (
      # Consolidate a list of all active unique services
      SELECT DISTINCT service_name, 'service' AS type FROM (
        SELECT caller AS service_name FROM raw_dependencies
        UNION DISTINCT
        SELECT callee AS service_name FROM raw_dependencies
      )
    ),
    
    indexed_nodes AS (
      # Assign a unique integer node ID to each service
      SELECT 
        ROW_NUMBER() OVER() - 1 AS node_id,
        service_name,
        type
      FROM all_services
    )
    
    # Select nodes and their linkages to build edge files
    SELECT 
      src.node_id AS source_id,
      dst.node_id AS destination_id,
      src.service_name AS source_name,
      dst.service_name AS destination_name
    FROM raw_dependencies rd
    JOIN indexed_nodes src ON rd.caller = src.service_name
    JOIN indexed_nodes dst ON rd.callee = dst.service_name
    """
    
    try:
        query_job = client.query(query)
        results = list(query_job.result())
        
        if not results:
            print("⚠ No telemetry linkages found in metric export tables. Check if Prometheus/Istio metrics are exporting.")
            print("Try running with --dry_run to bootstrap test topology tables.")
            return

        # Build nodes and edges lists
        nodes = {}
        edges = []
        
        node_id_counter = 0
        edge_id_counter = 1000
        
        for row in results:
            src_name = row["source_name"]
            dst_name = row["destination_name"]
            
            if src_name not in nodes:
                nodes[src_name] = {"node_id": node_id_counter, "node_name": src_name, "service_type": "backend"}
                node_id_counter += 1
            if dst_name not in nodes:
                nodes[dst_name] = {"node_id": node_id_counter, "node_name": dst_name, "service_type": "backend"}
                node_id_counter += 1
                
            edges.append({
                "edge_id": edge_id_counter,
                "source_id": nodes[src_name]["node_id"],
                "destination_id": nodes[dst_name]["node_id"],
                "dependency_type": "network"
            })
            edge_id_counter += 1
            
        # Clear existing tables and insert
        client.query(f"TRUNCATE TABLE `{project_id}.{dataset_id}.graph_nodes`").result()
        client.query(f"TRUNCATE TABLE `{project_id}.{dataset_id}.graph_edges`").result()
        
        client.insert_rows_json(f"{project_id}.{dataset_id}.graph_nodes", list(nodes.values()))
        client.insert_rows_json(f"{project_id}.{dataset_id}.graph_edges", edges)
        
        print(f"✓ Dynamically extracted and wrote {len(nodes)} nodes and {len(edges)} edges from metrics.")
        
    except Exception as e:
        print(f"Error querying BigQuery metrics: {e}")
        sys.exit(1)

def extract_from_logs(client, project_id, dataset_id, logs_dataset):
    """
    Extracts topology edges and nodes from Log Analytics.
    Searches for tracing/payload logs showing calls between services.
    """
    print(f"Extracting topology from Log Analytics: {project_id}.{logs_dataset}._AllLogs...")
    
    # Query logs that record client call relationships or span events
    query = f"""
    WITH trace_calls AS (
      SELECT DISTINCT
        JSON_VALUE(jsonPayload.service_name) AS caller,
        JSON_VALUE(jsonPayload.target_service) AS callee
      FROM `{project_id}.{logs_dataset}._AllLogs`
      WHERE log_id = "app-trace-logs" 
        AND JSON_VALUE(jsonPayload.service_name) IS NOT NULL
        AND JSON_VALUE(jsonPayload.target_service) IS NOT NULL
        AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)
    )
    SELECT caller, callee FROM trace_calls
    """
    
    try:
        query_job = client.query(query)
        results = list(query_job.result())
        
        if not results:
            print("⚠ No trace relationships found in Log Analytics _AllLogs. Ensure your apps log dependency links.")
            print("Try running with --dry_run to bootstrap test topology tables.")
            return

        nodes = {}
        edges = []
        node_id_counter = 0
        edge_id_counter = 1000
        
        for row in results:
            caller = row["caller"]
            callee = row["callee"]
            
            if caller not in nodes:
                nodes[caller] = {"node_id": node_id_counter, "node_name": caller, "service_type": "backend"}
                node_id_counter += 1
            if callee not in nodes:
                nodes[callee] = {"node_id": node_id_counter, "node_name": callee, "service_type": "backend"}
                node_id_counter += 1
                
            edges.append({
                "edge_id": edge_id_counter,
                "source_id": nodes[caller]["node_id"],
                "destination_id": nodes[callee]["node_id"],
                "dependency_type": "rpc"
            })
            edge_id_counter += 1

        client.query(f"TRUNCATE TABLE `{project_id}.{dataset_id}.graph_nodes`").result()
        client.query(f"TRUNCATE TABLE `{project_id}.{dataset_id}.graph_edges`").result()
        
        client.insert_rows_json(f"{project_id}.{dataset_id}.graph_nodes", list(nodes.values()))
        client.insert_rows_json(f"{project_id}.{dataset_id}.graph_edges", edges)
        
        print(f"✓ Dynamically extracted and wrote {len(nodes)} nodes and {len(edges)} edges from logs.")
        
    except Exception as e:
        print(f"Error querying BigQuery Log Analytics: {e}")
        sys.exit(1)

def main():
    args = parse_args()
    client = bigquery.Client(project=args.project_id)
    
    if args.dry_run:
        seed_sample_topology(client, args.project_id, args.dataset_id)
    elif args.mode == "metrics":
        extract_from_metrics(client, args.project_id, args.dataset_id, args.metrics_dataset)
    else:
        extract_from_logs(client, args.project_id, args.dataset_id, args.logs_dataset)

if __name__ == "__main__":
    main()
