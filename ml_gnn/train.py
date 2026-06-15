import os
import json
import torch
import torch.nn as nn
from model import GNNTopologyCascadePredictor

# Set random seed for reproducibility
torch.manual_seed(42)

def generate_synthetic_topology():
    """
    Creates a premium, high-fidelity microservice topology graph.
    
    Topological Layout:
      [ingress-gateway] (Node 0)
             │
             ▼
       [api-portal] (Node 1)
        /          \
       ▼            ▼
  [auth-service]  [payment-service] (Nodes 2 & 3)
                        │
                        ▼
                   [payment-db] (Node 4)

    Node Features: [CPU_Util, Memory_Util, Local_Error_Rate] (Normalized [0, 1])
    """
    # 5 nodes representing the microservices
    node_mapping = {
        0: "ingress-gateway",
        1: "api-portal",
        2: "auth-service",
        3: "payment-service",
        4: "payment-db"
    }
    
    # Define directed topological links representing dependency cascades (source relies on target)
    # (e.g., payment-service [3] relies on payment-db [4])
    edges = torch.tensor([
        [0, 1],  # ingress-gateway relies on api-portal
        [1, 2],  # api-portal relies on auth-service
        [1, 3],  # api-portal relies on payment-service
        [3, 4],  # payment-service relies on payment-db
    ], dtype=torch.long).t() # Shape: [2, num_edges]

    # To allow message passing in both directions, we convert to bidirectional (undirected) edge indices
    undirected_edges = torch.cat([edges, edges.flip(0)], dim=1)
    
    return node_mapping, undirected_edges

def generate_training_scenarios():
    """
    Synthesizes historical incidents to teach the GNN how failures cascade.
    We create three distinct high-fidelity training scenarios.
    """
    _, edge_index = generate_synthetic_topology()
    scenarios = []

    # --------------------------------------------------------------------------
    # Scenario 1: Nominal State (No Anomalies)
    # --------------------------------------------------------------------------
    # Node features: [CPU, RAM, Errors]
    x_nominal = torch.tensor([
        [0.15, 0.25, 0.00],  # ingress-gateway
        [0.20, 0.30, 0.00],  # api-portal
        [0.10, 0.40, 0.00],  # auth-service
        [0.25, 0.35, 0.00],  # payment-service
        [0.05, 0.15, 0.00],  # payment-db
    ], dtype=torch.float)
    # Labels: Cascade risk probability (all nominally zero)
    y_nominal = torch.tensor([[0.0], [0.0], [0.0], [0.0], [0.0]], dtype=torch.float)
    scenarios.append((x_nominal, y_nominal))

    # --------------------------------------------------------------------------
    # Scenario 2: Downstream Database Outage Cascade
    # --------------------------------------------------------------------------
    # Node 4 (payment-db) crashes completely. 
    # Failure propagates upward: Node 3 fails, Node 1 degrades, Node 0 experiences minor stress, Node 2 remains safe.
    x_db_outage = torch.tensor([
        [0.45, 0.35, 0.10],  # ingress-gateway (moderately stressed)
        [0.75, 0.60, 0.55],  # api-portal (highly degraded error rate)
        [0.12, 0.42, 0.00],  # auth-service (isolated, healthy)
        [0.95, 0.85, 0.90],  # payment-service (severely crippled)
        [0.99, 0.95, 1.00],  # payment-db (active epicenter / crashed)
    ], dtype=torch.float)
    # Expected cascade risks:
    y_db_outage = torch.tensor([[0.20], [0.70], [0.00], [0.95], [1.00]], dtype=torch.float)
    scenarios.append((x_db_outage, y_db_outage))

    # --------------------------------------------------------------------------
    # Scenario 3: Auth Service Memory Leak Slowdown Cascade
    # --------------------------------------------------------------------------
    # Node 2 (auth-service) leaks memory.
    # Failure propagates to Node 1 (api-portal) causing connection pooling limits. Node 0 degrades slightly.
    x_auth_leak = torch.tensor([
        [0.25, 0.30, 0.05],  # ingress-gateway
        [0.85, 0.70, 0.40],  # api-portal (stressed due to slow auth)
        [0.40, 0.99, 0.80],  # auth-service (memory leak + local timeout errors)
        [0.20, 0.35, 0.00],  # payment-service (unaffected)
        [0.05, 0.15, 0.00],  # payment-db (unaffected)
    ], dtype=torch.float)
    # Expected cascade risks:
    y_auth_leak = torch.tensor([[0.10], [0.65], [1.00], [0.00], [0.00]], dtype=torch.float)
    scenarios.append((x_auth_leak, y_auth_leak))

    return scenarios

def train_model():
    print("======================================================================")
    print("Starting Topological Graph Neural Network (GNN) Model Training")
    print("======================================================================")
    
    # 1. Compile Graph Topology Layout
    node_mapping, edge_index = generate_synthetic_topology()
    print(f"Loaded microservice nodes count: {len(node_mapping)}")
    print(f"Graph topology linkages edge dimensions: {edge_index.shape}")
    
    # 2. Instantiate GNN Model
    # Node features: 3 (CPU, RAM, Error Rate)
    # Hidden dimension embeddings: 16
    model = GNNTopologyCascadePredictor(num_node_features=3, hidden_dim=16)
    
    # 3. Setup optimizer and BCE loss function
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01, weight_decay=1e-4)
    criterion = nn.BCELoss() # Binary Cross Entropy for probabilities
    
    # 4. Load Scenarios
    scenarios = generate_training_scenarios()
    print(f"Generated {len(scenarios)} historical incident training scenarios.")
    
    # 5. Execute Training epochs
    epochs = 400
    model.train()
    print(f"Training for {epochs} epochs over topology graph...")
    
    for epoch in range(1, epochs + 1):
        epoch_loss = 0.0
        optimizer.zero_grad()
        
        # Convolve and accumulate loss across all incident scenarios
        for x, y_target in scenarios:
            pred = model(x, edge_index)
            loss = criterion(pred, y_target)
            loss.backward()
            epoch_loss += loss.item()
            
        optimizer.step()
        
        if epoch % 50 == 0 or epoch == 1:
            print(f"Epoch {epoch:03d} / {epochs} | Cumulative Scenario Loss: {epoch_loss:.6f}")

    # 6. Evaluation and Verification
    model.eval()
    with torch.no_grad():
        print("\nTraining completed! Evaluating final convolved predictions:")
        test_x, test_y = scenarios[1] # Downstream DB Outage scenario
        predictions = model(test_x, edge_index)
        
        for node_idx, service_name in node_mapping.items():
            true_risk = test_y[node_idx].item() * 100
            pred_risk = predictions[node_idx].item() * 100
            print(f" - [{service_name}] -> True Cascade Risk: {true_risk:.1f}% | GNN Forecasted Risk: {pred_risk:.1f}%")

    # 7. Serialize Weights and Metadata configuration
    output_dir = "ml_gnn/artifacts"
    os.makedirs(output_dir, exist_ok=True)
    
    model_path = os.path.join(output_dir, "model.pt")
    torch.save(model.state_dict(), model_path)
    print(f"\nModel state dictionary weights written to: {model_path}")
    
    meta_path = os.path.join(output_dir, "metadata.json")
    metadata = {
        "num_node_features": 3,
        "hidden_dim": 16,
        "node_mapping": node_mapping,
        "edge_index": edge_index.tolist()
    }
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"ML metadata configurations written to: {meta_path}")
    print("======================================================================")

if __name__ == "__main__":
    train_model()
