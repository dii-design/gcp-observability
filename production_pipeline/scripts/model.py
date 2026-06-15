import torch
import torch.nn.functional as F
from torch_geometric.nn import GCNConv

class GNNTopologyCascadePredictor(torch.nn.Module):
    def __init__(self, num_node_features, hidden_dim):
        """
        Graph Neural Network to predict cascading failure risks across a production service topology.
        
        It convolves node-level telemetry metrics over dependency linkages using Graph Convolutional 
        Networks (GCN) to calculate cascading failure risk.

        Args:
            num_node_features (int): Number of features per service node. 
                                     For this implementation, it is 4:
                                     [cpu_util, throughput_ratio, network_socket_exhaustion, db_connectivity_error_rate]
            hidden_dim (int): Dimensionality of GCN layer embeddings.
        """
        super(GNNTopologyCascadePredictor, self).__init__()
        
        # Conv layer 1: Aggregates features from direct 1-hop neighbors
        self.conv1 = GCNConv(num_node_features, hidden_dim)
        
        # Conv layer 2: Aggregates features from 2-hop neighbors (captures multi-hop propagation)
        self.conv2 = GCNConv(hidden_dim, hidden_dim)
        
        # Fully connected output layer maps convolved representation to failure probability
        self.out = torch.nn.Linear(hidden_dim, 1)

    def forward(self, x, edge_index):
        """
        Executes the topological convolved forward pass.

        Args:
            x (Tensor): Node feature matrix of shape [num_nodes, 4]
            edge_index (Tensor): Graph edge indices (topology connections) of shape [2, num_edges]
        
        Returns:
            Tensor: Failure propagation risk probabilities for each node of shape [num_nodes, 1]
        """
        # Phase 1: First Graph Convolution + RELU Activation + Dropout
        x = self.conv1(x, edge_index)
        x = F.relu(x)
        x = F.dropout(x, p=0.1, training=self.training)
        
        # Phase 2: Second Graph Convolution + RELU Activation
        x = self.conv2(x, edge_index)
        x = F.relu(x)
        
        # Phase 3: Linear Mapping + Sigmoid activation to get risk probability
        out_logits = self.out(x)
        return torch.sigmoid(out_logits)
