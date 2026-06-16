import os
import sys
import subprocess
import urllib.request
import platform

PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "YOUR_PROJECT_ID")
CLUSTER_NAME = "autopilot-cluster-2"
REGION = "us-central1"
KUBECTL_PATH = "./simulator/kubectl"
KUBECONFIG_PATH = "./simulator/kubeconfig_sim"
MANIFEST_PATH = "./simulator/k8s_simulation.yaml"

def run_cmd(cmd, env=None):
    """Run a shell command and return its output as a string."""
    try:
        res = subprocess.run(cmd, shell=True, check=True, text=True, capture_output=True, env=env)
        return res.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"Error running command: {cmd}")
        print(f"Exit code: {e.returncode}")
        print(f"Stdout: {e.stdout}")
        print(f"Stderr: {e.stderr}")
        sys.exit(1)

def check_or_download_kubectl():
    """Ensure kubectl binary is available in the simulator folder."""
    if os.path.exists(KUBECTL_PATH):
        print("✓ Standalone kubectl binary already exists.")
        return
        
    system = platform.system().lower()
    machine = platform.machine().lower()
    if machine in ('x86_64', 'amd64'):
        arch = 'amd64'
    elif machine in ('arm64', 'aarch64'):
        arch = 'arm64'
    else:
        arch = machine
        
    print(f"Downloading standalone {system} {arch} kubectl binary (v1.30.0)...")
    url = f"https://dl.k8s.io/release/v1.30.0/bin/{system}/{arch}/kubectl"
    
    try:
        urllib.request.urlretrieve(url, KUBECTL_PATH)
        os.chmod(KUBECTL_PATH, 0o755)
        print("✓ kubectl downloaded and made executable successfully.")
    except Exception as e:
        print(f"Failed to download kubectl: {e}")
        sys.exit(1)

def get_cluster_details():
    """Retrieve cluster endpoint and CA certificate from gcloud CLI."""
    print("Querying cluster status and endpoint configurations...")
    
    # Check status first
    status = run_cmd(f"gcloud container clusters describe {CLUSTER_NAME} --region={REGION} --project={PROJECT_ID} --format='value(status)'")
    if status != "RUNNING":
        print(f"⚠ Cluster status is currently: {status}. Waiting for it to become RUNNING...")
        return None
        
    endpoint = run_cmd(f"gcloud container clusters describe {CLUSTER_NAME} --region={REGION} --project={PROJECT_ID} --format='value(endpoint)'")
    ca_cert = run_cmd(f"gcloud container clusters describe {CLUSTER_NAME} --region={REGION} --project={PROJECT_ID} --format='value(masterAuth.clusterCaCertificate)'")
    
    print(f"✓ Cluster endpoint found: {endpoint}")
    return {"endpoint": endpoint, "ca_cert": ca_cert}

def generate_kubeconfig(endpoint, ca_cert):
    """Generate a custom, standalone kubeconfig file using the OAuth access token."""
    print("Generating temporary kubeconfig file...")
    
    # Retrieve short-lived OAuth Access Token
    token = run_cmd("gcloud auth print-access-token")
    
    kubeconfig_yaml = f"""apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: {ca_cert}
    server: https://{endpoint}
  name: gke-cluster
contexts:
- context:
    cluster: gke-cluster
    user: gke-user
  name: gke-context
current-context: gke-context
users:
- name: gke-user
  user:
    token: {token}
"""
    
    with open(KUBECONFIG_PATH, "w") as f:
        f.write(kubeconfig_yaml)
    
    print(f"✓ Standalone kubeconfig written to: {KUBECONFIG_PATH}")

def deploy_workload():
    """Run kubectl to apply the simulator workload."""
    print("Deploying simulation workload onto GKE Autopilot cluster...")
    env = os.environ.copy()
    env["KUBECONFIG"] = KUBECONFIG_PATH
    
    # Run kubectl apply
    stdout = run_cmd(f"{KUBECTL_PATH} apply -f {MANIFEST_PATH}", env=env)
    print(stdout)
    
    print("\n-----------------------------------------------------------")
    print("✓ SUCCESS: Workload and ConfigMap deployed to the GKE cluster.")
    print("-----------------------------------------------------------")
    print("Wait 1-2 minutes for GKE Autopilot to provision nodes and schedule the pod.")
    print("You can monitor the status using the following command:")
    print(f"  KUBECONFIG={KUBECONFIG_PATH} {KUBECTL_PATH} get pods --watch")

if __name__ == "__main__":
    check_or_download_kubectl()
    
    details = get_cluster_details()
    if details:
        generate_kubeconfig(details["endpoint"], details["ca_cert"])
        deploy_workload()
    else:
        print("Please wait for the cluster to finish provisioning and re-run this script.")
