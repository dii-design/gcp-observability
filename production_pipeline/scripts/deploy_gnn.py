#!/usr/bin/env python3
"""
Production GNN Deployment Script

This script builds the Docker container, pushes it to Google Artifact Registry,
registers it in the Vertex AI Model Registry, and deploys it to the Vertex AI Endpoint.
"""

import argparse
import os
import sys
from google.cloud import aiplatform

def parse_args():
    parser = argparse.ArgumentParser(description="Build and deploy GNN model to Vertex AI.")
    parser.add_argument("--project_id", required=True, help="The GCP Project ID.")
    parser.add_argument("--region", default="us-central1", help="The GCP Region.")
    parser.add_argument("--repo_name", default="telemetry-ml-registry", help="Artifact Registry repository name.")
    parser.add_argument("--image_name", default="gnn-cascade-predictor", help="Docker image name.")
    parser.add_argument("--image_tag", default="v1", help="Docker image tag.")
    parser.add_argument("--endpoint_id", help="The Vertex AI Endpoint ID (from Terraform outputs).")
    parser.add_argument("--run_deploy", action="store_true", help="Execute Vertex AI deployment API calls.")
    return parser.parse_args()

def print_cli_instructions(args, container_uri):
    """Prints Docker and gcloud CLI commands to build and push the container."""
    print("=" * 80)
    print(" DOCKER BUILD & PUSH INSTRUCTIONS")
    print("=" * 80)
    print(f"# 1. Create Artifact Registry repository (if it doesn't exist):")
    print(f"gcloud artifacts repositories create {args.repo_name} \\")
    print(f"    --repository-format=docker \\")
    print(f"    --location={args.region} \\")
    print(f"    --project={args.project_id}\\n")
    
    print(f"# 2. Authenticate Docker with the repository:")
    print(f"gcloud auth configure-docker {args.region}-docker.pkg.dev\\n")
    
    print(f"# 3. Build the serving container:")
    print(f"docker build -t {args.image_name}:{args.image_tag} .\\n")
    
    print(f"# 4. Tag the container image:")
    print(f"docker tag {args.image_name}:{args.image_tag} {container_uri}\\n")
    
    print(f"# 5. Push container to Google Artifact Registry:")
    print(f"docker push {container_uri}")
    print("=" * 80)

def deploy_to_vertex(args, container_uri):
    """Orchestrates model upload and endpoint deployment via Vertex AI SDK."""
    if not args.endpoint_id:
        print("Error: --endpoint_id is required to execute deployment.")
        sys.exit(1)
        
    print("\n" + "=" * 80)
    print(" ORCHESTRATING VERTEX AI GNN DEPLOYMENT")
    print("=" * 80)
    
    print(f"Initializing Vertex AI SDK (Project: {args.project_id}, Region: {args.region})...")
    aiplatform.init(project=args.project_id, location=args.region)
    
    # 1. Register model
    print(f"Registering Model Image: {container_uri} in Vertex AI Model Registry...")
    try:
        model = aiplatform.Model.upload(
            display_name="gnn-cascade-predictor-production",
            description="Production Graph Neural Network Cascade Failure Predictor",
            serving_container_image_uri=container_uri,
            serving_container_predict_route="/predict",
            serving_container_health_route="/health",
            serving_container_ports=[8080],
        )
        print(f"✓ Model successfully registered! Resource Name: {model.resource_name}")
    except Exception as e:
        print(f"Model registration failed: {e}")
        sys.exit(1)
        
    # 2. Retrieve endpoint
    endpoint_resource = f"projects/{args.project_id}/locations/{args.region}/endpoints/{args.endpoint_id}"
    print(f"Retrieving active Vertex AI Endpoint: {endpoint_resource}...")
    try:
        endpoint = aiplatform.Endpoint(endpoint_name=endpoint_resource)
        print(f"✓ Endpoint retrieved: {endpoint.display_name}")
    except Exception as e:
        print(f"Failed to retrieve Endpoint: {e}")
        sys.exit(1)
        
    # 3. Deploy model to endpoint
    print("Deploying Model to Endpoint (n1-standard-4 standard CPU instance)...")
    try:
        model.deploy(
            endpoint=endpoint,
            deployed_model_display_name="gnn-cascade-predictor-prod-v1",
            machine_type="n1-standard-4",
            min_replica_count=1,
            max_replica_count=3,
            traffic_percentage=100,
        )
        print(f"\n✓ SUCCESS: GNN Cascade Predictor is live on your endpoint!")
        print(f"Endpoint URL: https://{args.region}-aiplatform.googleapis.com/v1/{endpoint_resource}:predict")
    except Exception as e:
        print(f"Deployment failed: {e}")
        sys.exit(1)

def main():
    args = parse_args()
    container_uri = f"{args.region}-docker.pkg.dev/{args.project_id}/{args.repo_name}/{args.image_name}:{args.image_tag}"
    
    print_cli_instructions(args, container_uri)
    
    if args.run_deploy:
        deploy_to_vertex(args, container_uri)
    else:
        print("\nRun with --run_deploy and --endpoint_id to automatically execute the Vertex AI Model Registry upload and Endpoint deployment.")

if __name__ == "__main__":
    main()
