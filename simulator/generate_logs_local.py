import subprocess
import json
import time
import random

countries = ["US", "GB", "JP"]
sites = ["us-east-site", "gb-lon-site", "jp-tok-site"]

print("=== Injecting Batch ServiceNow Logs to Cloud Logging ===")

for i in range(120):
    # Select country and site
    country = random.choice(countries)
    site = sites[countries.index(country)]
    
    log_payload = {
        "event": "incident",
        "message": "ServiceNow incident created",
        "country": country,
        "site": site,
        "severity": "ERROR",
        "iteration": i
    }
    
    payload_str = json.dumps(log_payload)
    # Run gcloud logging write
    cmd = f"gcloud logging write servicenow-sim-log '{payload_str}' --payload-type=json"
    
    try:
        subprocess.run(cmd, shell=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if (i + 1) % 10 == 0:
            print(f"✓ Injected {i + 1}/120 logs ({country} - {site})")
        # Throttle slightly to be nice to API rate limits
        time.sleep(0.1)
    except subprocess.CalledProcessError as e:
        print(f"Error injecting log {i+1}: {e}")
        break

print("=== Batch Injection Completed ===")
