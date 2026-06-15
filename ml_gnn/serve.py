import os
import json
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from model import GNNTopologyCascadePredictor

app = FastAPI(
    title="GNN Anomaly Cascade Predictor Serving Engine",
    description="Topological inference service hosted as a custom model on Google Vertex AI",
    version="1.0.0"
)

# Global variables for model state and configuration
MODEL = None
METADATA = None

class PredictionInstance(BaseModel):
    # Node features: Shape [num_nodes, num_node_features], represents current telemetry: [CPU, RAM, ErrorRate]
    x: List[List[float]] = Field(..., description="Node feature matrix representing active node metrics: [CPU, Memory, Error_Rate]")
    # Edge index: Shape [2, num_edges], represents topology links
    edge_index: List[List[int]] = Field(..., description="Topological linkages representation in edge coordinate list format [source_indices, dest_indices]")
    # Optional names
    node_names: Optional[List[str]] = Field(None, description="Optional names to label output prediction keys")

class VertexAIRequest(BaseModel):
    # Vertex AI Custom Container standard envelopes all inference payloads inside an "instances" key
    instances: List[PredictionInstance]

def load_saved_model():
    """
    Loads saved model weight state and metadata configurations from the artifacts subdirectory.
    """
    global MODEL, METADATA
    
    artifacts_dir = os.path.join(os.path.dirname(__file__), "artifacts")
    model_path = os.path.join(artifacts_dir, "model.pt")
    meta_path = os.path.join(artifacts_dir, "metadata.json")
    
    if not (os.path.exists(model_path) and os.path.exists(meta_path)):
        # Initialize an untrained model shell if no saved weights exist yet
        print("Warning: Serialized model weights not found. Initializing untrained default model.")
        METADATA = {
            "num_node_features": 3,
            "hidden_dim": 16,
            "node_mapping": {str(i): f"node-{i}" for i in range(5)}
        }
        MODEL = GNNTopologyCascadePredictor(num_node_features=3, hidden_dim=16)
    else:
        # Load metadata configurations
        with open(meta_path, "r") as f:
            METADATA = json.load(f)
        
        # Instantiate GNN architecture using matching hyper-parameters
        MODEL = GNNTopologyCascadePredictor(
            num_node_features=METADATA["num_node_features"],
            hidden_dim=METADATA["hidden_dim"]
        )
        
        # Load weights state dictionary (CPU-map since serving nodes default to CPU)
        MODEL.load_state_dict(torch.load(model_path, map_location=torch.device("cpu")))
        print(f"Successfully loaded serialized model weights from: {model_path}")
        
    MODEL.eval()

@app.on_event("startup")
def startup_event():
    load_saved_model()

@app.get("/")
@app.get("/health")
def health_check():
    """
    Liveness and readiness health-check endpoint.
    Vertex AI queries this endpoint on port 8080 to monitor model container health.
    """
    return {
        "status": "HEALTHY",
        "engine": "PyTorch Geometric GNN Cascade Predictor",
        "loaded_model": "model.pt",
        "has_weights": MODEL is not None
    }

@app.post("/predict")
def predict(payload: VertexAIRequest):
    """
    Vertex AI Custom Prediction endpoint.
    Processes the batch of instances, computes convolved forward passes,
    and returns downstream cascade risk probabilities.
    """
    if MODEL is None:
        raise HTTPException(status_code=503, detail="Model state is currently uninitialized or uncompiled.")

    predictions_response = []
    
    try:
        # Loop through batches in standard Vertex AI envelope
        for instance in payload.instances:
            # Parse inputs into PyTorch Tensors
            x_tensor = torch.tensor(instance.x, dtype=torch.float)
            edge_index_tensor = torch.tensor(instance.edge_index, dtype=torch.long)
            
            # Basic validation
            if len(edge_index_tensor) != 2:
                raise ValueError("edge_index must have shape [2, num_edges]")
                
            # Perform topological convolved inference
            with torch.no_grad():
                out_risk = MODEL(x_tensor, edge_index_tensor)
                
            # Formulate the response mapping
            node_risks = {}
            num_nodes = x_tensor.shape[0]
            
            # Resolve human-readable node names
            resolved_names = instance.node_names
            if resolved_names is None:
                # Try loading from trained metadata mapping or default to indexes
                meta_mapping = METADATA.get("node_mapping", {})
                resolved_names = [meta_mapping.get(str(i), f"microservice-node-{i}") for i in range(num_nodes)]
            
            for idx in range(min(num_nodes, len(resolved_names))):
                risk_val = out_risk[idx].item()
                node_risks[resolved_names[idx]] = {
                    "cascade_risk_probability": round(risk_val, 4),
                    "is_cascade_alert_triggered": risk_val > 0.75, # Matches GCM custom metric alert threshold
                    "telemetry_state": {
                        "cpu_util": round(instance.x[idx][0], 4),
                        "mem_util": round(instance.x[idx][1], 4),
                        "local_error_rate": round(instance.x[idx][2], 4)
                    }
                }
            
            predictions_response.append({
                "predictions": node_risks
            })
            
        return {"predictions": predictions_response}

    except Exception as e:
        print(f"Inference Failure: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Inference operation failed: {str(e)}")

# Fallback direct query handler for simplified API curls bypass
@app.post("/predict_direct")
def predict_direct(instance: PredictionInstance):
    """
    Bypasses standard Vertex AI array packaging. Direct REST query endpoint.
    """
    if MODEL is None:
        raise HTTPException(status_code=503, detail="Model is uninitialized.")
    
    try:
        x_tensor = torch.tensor(instance.x, dtype=torch.float)
        edge_index_tensor = torch.tensor(instance.edge_index, dtype=torch.long)
        
        with torch.no_grad():
            out_risk = MODEL(x_tensor, edge_index_tensor)
            
        num_nodes = x_tensor.shape[0]
        meta_mapping = METADATA.get("node_mapping", {})
        resolved_names = instance.node_names or [meta_mapping.get(str(i), f"node-{i}") for i in range(num_nodes)]
        
        node_risks = {}
        for idx in range(min(num_nodes, len(resolved_names))):
            risk_val = out_risk[idx].item()
            node_risks[resolved_names[idx]] = {
                "cascade_risk_probability": round(risk_val, 4),
                "is_cascade_alert_triggered": risk_val > 0.75
            }
            
        return {"predictions": node_risks}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    # Bind to port 8080 by default (Vertex AI custom container specification)
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("serve:app", host="0.0.0.0", port=port, reload=True)
