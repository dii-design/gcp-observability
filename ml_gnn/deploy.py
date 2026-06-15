"""
GCP Vertex AI GNN Model Deployment Orchestrator

This script provides the blueprint for registering your custom PyTorch Geometric 
container model into the Google Cloud Vertex AI Model Registry, and deploying 
it directly to the 'GNN Anomaly Cascade Predictor Endpoint' provisioned by your Terraform.

Prerequisites:
  1. Install the official Google Cloud AI Platform library:
     $ pip install google-cloud-aiplatform
  2. Authenticate with your GCP account:
     $ gcloud auth login
     $ gcloud auth application-default login
"""

import os
from google.cloud import aiplatform

# ==============================================================================
PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "YOUR_PROJECT_ID")
REGION = "us-central1"
REPOSITORY_NAME = "telemetry-ml-registry"  # Artifact Registry repo name
IMAGE_NAME = "gnn-cascade-predictor"
IMAGE_TAG = "v1"

# Endpoint ID from Terraform outputs (e.g. google_vertex_ai_endpoint.gnn_endpoint.id)
# You can find this in GCP console or by running 'terraform output gnn_endpoint_id'
ENDPOINT_ID = os.environ.get("VERTEX_ENDPOINT_ID", f"projects/{PROJECT_ID}/locations/{REGION}/endpoints/YOUR_ENDPOINT_ID")

# Format the Artifact Registry image URI
CONTAINER_IMAGE_URI = f"{REGION}-docker.pkg.dev/{PROJECT_ID}/{REPOSITORY_NAME}/{IMAGE_NAME}:{IMAGE_TAG}"

def print_setup_commands():
    """
    Prints the CLI commands required to build, tag, and push the custom GNN container to GCP.
    """
    print("=" * 80)
    print(" SHELL COMMANDS: BUILD & PUSH CUSTOM MODEL CONTAINER TO GCP")
    print("=" * 80)
    print(f"# 1. Create a Google Artifact Registry Docker Repository inside your project:")
    print(f"gcloud artifacts repositories create {REPOSITORY_NAME} \\")
    print(f"    --repository-format=docker \\")
    print(f"    --location={REGION} \\")
    print(f"    --description=\"Docker repository for GNN telemetry models\" \\")
    print(f"    --project={PROJECT_ID}\n")
    
    print(f"# 2. Authenticate local Docker daemon with Google Artifact Registry:")
    print(f"gcloud auth configure-docker {REGION}-docker.pkg.dev\n")
    
    print(f"# 3. Compile and build the custom PyTorch Geometric serving container locally:")
    print(f"docker build -t {IMAGE_NAME}:{IMAGE_TAG} ./ml_gnn\n")
    
    print(f"# 4. Tag the container image with the remote GCP repository path:")
    print(f"docker tag {IMAGE_NAME}:{IMAGE_TAG} {CONTAINER_IMAGE_URI}\n")
    
    print(f"# 5. Push the container to Google Cloud Artifact Registry:")
    print(f"docker push {CONTAINER_IMAGE_URI}")
    print("=" * 80)

def deploy_gnn_pipeline_to_vertex():
    """
    Orchestrates Vertex AI SDK registration and Endpoint deployment.
    """
    print("\n" + "=" * 80)
    print(" ORCHESTRATING VERTEX AI GNN MODEL REGISTRATION & DEPLOYMENT")
    print("=" * 80)
    
    print(f"Initializing Vertex AI SDK in project {PROJECT_ID} (Region: {REGION})...")
    aiplatform.init(project=PROJECT_ID, location=REGION)
    
    # 1. Register the custom container model in Vertex AI Model Registry
    print(f"Registering Custom Model Image: {CONTAINER_IMAGE_URI} in Vertex Model Registry...")
    try:
        model = aiplatform.Model.upload(
            display_name="gnn-cascade-predictor-model",
            description="Topology-Aware Graph Neural Network (GNN) Cascade Outage Predictor",
            serving_container_image_uri=CONTAINER_IMAGE_URI,
            serving_container_predict_route="/predict",
            serving_container_health_route="/health",
            serving_container_ports=[8080], # Matches FastAPI port in Dockerfile
        )
        print(f"Model successfully registered! Resource Name: {model.resource_name}")
    except Exception as e:
        print(f"Failed to register model: {str(e)}")
        print("Make sure you have pushed the container image first.")
        return

    # 2. Retrieve existing Vertex AI Endpoint provisioned by Terraform
    print(f"Retrieving active Vertex AI Endpoint (ID: {ENDPOINT_ID})...")
    try:
        endpoint = aiplatform.Endpoint(endpoint_name=ENDPOINT_ID)
        print(f"Successfully retrieved active Endpoint: {endpoint.display_name}")
    except Exception as e:
        print(f"Failed to retrieve Endpoint: {str(e)}")
        print("Ensure the endpoint resource was successfully provisioned by Terraform.")
        return

    # 3. Deploy the registered Model to the active Endpoint
    # We specify a small, cost-effective standard CPU compute instance.
    print(f"Deploying Model to Endpoint with standard autoscaling...")
    try:
        model.deploy(
            endpoint=endpoint,
            deployed_model_display_name="gnn-cascade-predictor-v1-deployment",
            machine_type="n1-standard-4", # High-performance virtual core node
            min_replica_count=1,          # Scale down min to 1 (set to 0 for serverless if supported)
            max_replica_count=3,          # Peak loads autoscale limit
            traffic_percentage=100,
        )
        print(f"\nSUCCESS: GNN Cascade Predictor is live on your endpoint!")
        print(f"Endpoint URL: https://{REGION}-aiplatform.googleapis.com/v1/{ENDPOINT_ID}:predict")
    except Exception as e:
        print(f"Deployment failed: {str(e)}")

if __name__ == "__main__":
    print_setup_commands()
    # To run the automated deployment, uncomment the function call below after your container is pushed:
    # deploy_gnn_pipeline_to_vertex()
