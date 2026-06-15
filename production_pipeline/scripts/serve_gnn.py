import os
import json
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from model import GNNTopologyCascadePredictor

app = FastAPI(
    title="Production GNN Anomaly Cascade Predictor Serving Engine",
    description="Topological failure cascade inference service hosted on Google Vertex AI",
    version="1.1.0"
)

# Global model state
MODEL = None
METADATA = None

class PredictionInstance(BaseModel):
    # Node features: Shape [num_nodes, 4], represents telemetry: [cpu_util, throughput_ratio, network_socket_exhaustion, db_connectivity_error_rate]
    x: List[List[float]] = Field(..., description="Node feature matrix of shape [num_nodes, 4]: [cpu_util, throughput_ratio, network_socket_exhaustion, db_connectivity_error_rate] for each service node.")
    # Edge index: Shape [2, num_edges]
    edge_index: List[List[int]] = Field(..., description="Topological linkages represented as a coordinate list [sources, destinations].")
    # Optional node names
    node_names: Optional[List[str]] = Field(None, description="Optional service names to index the returned prediction keys.")

class VertexAIRequest(BaseModel):
    # Vertex AI wraps the payload inside an "instances" key
    instances: List[PredictionInstance]

def load_saved_model():
    """Loads saved model weights and metadata configs."""
    global MODEL, METADATA
    
    # Path relative to script execution
    artifacts_dir = os.path.join(os.path.dirname(__file__), "artifacts")
    model_path = os.path.join(artifacts_dir, "model.pt")
    meta_path = os.path.join(artifacts_dir, "metadata.json")
    
    if not (os.path.exists(model_path) and os.path.exists(meta_path)):
        print("Warning: Serialized weights not found. Initializing shell model.")
        METADATA = {
            "num_node_features": 4,
            "hidden_dim": 16,
            "node_mapping": {str(i): f"service-{i}" for i in range(4)}
        }
        MODEL = GNNTopologyCascadePredictor(num_node_features=4, hidden_dim=16)
    else:
        with open(meta_path, "r") as f:
            METADATA = json.load(f)
            
        MODEL = GNNTopologyCascadePredictor(
            num_node_features=METADATA["num_node_features"],
            hidden_dim=METADATA["hidden_dim"]
        )
        MODEL.load_state_dict(torch.load(model_path, map_location=torch.device("cpu")))
        print(f"Successfully loaded model weights from: {model_path}")
        
    MODEL.eval()

@app.on_event("startup")
def startup_event():
    load_saved_model()

@app.get("/")
@app.get("/health")
def health():
    """Health check endpoint required by Vertex AI."""
    return {
        "status": "HEALTHY",
        "engine": "PyTorch Geometric GNN Cascade Predictor (Production)",
        "loaded_model": "model.pt",
        "has_weights": MODEL is not None
    }

@app.post("/predict")
def predict(payload: VertexAIRequest):
    """
    Vertex AI Custom Prediction endpoint.
    Performs GNN message passing over the active topology and returns failure risks.
    """
    if MODEL is None:
        raise HTTPException(status_code=503, detail="GNN model is currently uninitialized.")

    responses = []
    try:
        for instance in payload.instances:
            # Parse inputs into PyTorch Tensors
            x_tensor = torch.tensor(instance.x, dtype=torch.float)
            edge_index_tensor = torch.tensor(instance.edge_index, dtype=torch.long)
            
            if len(edge_index_tensor) != 2:
                raise ValueError("edge_index must have shape [2, num_edges]")
                
            # Run inference pass
            with torch.no_grad():
                out_risk = MODEL(x_tensor, edge_index_tensor)
                
            node_risks = {}
            num_nodes = x_tensor.shape[0]
            
            # Resolve node/service names
            resolved_names = instance.node_names
            if resolved_names is None:
                meta_mapping = METADATA.get("node_mapping", {})
                resolved_names = [meta_mapping.get(str(i), f"service-node-{i}") for i in range(num_nodes)]
                
            for idx in range(min(num_nodes, len(resolved_names))):
                risk_val = out_risk[idx].item()
                node_risks[resolved_names[idx]] = {
                    "cascade_risk_probability": round(risk_val, 4),
                    "is_cascade_alert_triggered": risk_val > 0.75,
                    "telemetry_state": {
                        "cpu_util": round(instance.x[idx][0], 4),
                        "throughput_ratio": round(instance.x[idx][1], 4),
                        "network_socket_exhaustion": round(instance.x[idx][2], 4),
                        "db_connectivity_error_rate": round(instance.x[idx][3], 4)
                    }
                }
                
            responses.append({"predictions": node_risks})
            
        return {"predictions": responses}
        
    except Exception as e:
        print(f"Inference error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("serve_gnn:app", host="0.0.0.0", port=port, reload=True)
