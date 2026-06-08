import os
import time
import sys
import json
import math
import shutil
import threading
import multiprocessing

# Configuration from environment variables (or defaults)
SPIKE_INTERVAL_SEC = int(os.getenv("SPIKE_INTERVAL_SEC", "120"))  # How often to trigger a stress wave
SPIKE_DURATION_SEC = int(os.getenv("SPIKE_DURATION_SEC", "60"))   # How long each stress wave lasts
LOG_RATE_NORMAL = float(os.getenv("LOG_RATE_NORMAL", "0.5"))     # Normal incident logs/sec
LOG_RATE_STORM = float(os.getenv("LOG_RATE_STORM", "50.0"))       # Incident logs/sec during storm

print("=== GCP Telemetry Anomaly & Alerting Simulator Starting ===")
print(f"Spike Interval: {SPIKE_INTERVAL_SEC}s, Duration: {SPIKE_DURATION_SEC}s")
print(f"Incident Log Rate: Normal={LOG_RATE_NORMAL}/s, Storm={LOG_RATE_STORM}/s")

# Global state
is_spiking = False

# ---------------------------------------------------------
# 1. LOG GENERATOR THREAD
# ---------------------------------------------------------
def log_generator():
    countries = ["US", "GB", "JP"]
    sites = ["us-east-site", "gb-lon-site", "jp-tok-site"]
    
    while True:
        current_rate = LOG_RATE_STORM if is_spiking else LOG_RATE_NORMAL
        sleep_time = 1.0 / max(current_rate, 0.01)
        
        # Select country/site based on current time to create variation
        idx = int(time.time() // 10) % len(countries)
        country = countries[idx]
        site = sites[idx]
        
        log_entry = {
            "severity": "ERROR" if is_spiking else "INFO",
            "event": "incident",
            "message": "ServiceNow incident created" if is_spiking or (time.time() % 10 < 3) else "Telemetry normal poll heartbeat",
            "country": country,
            "site": site,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "simulator_state": "STORM_SPIKE" if is_spiking else "NOMINAL"
        }
        
        print(json.dumps(log_entry))
        sys.stdout.flush()
        time.sleep(sleep_time)

# ---------------------------------------------------------
# 2. CPU STRESSOR PROCESS / THREADS
# ---------------------------------------------------------
def cpu_worker():
    # Keep CPU busy when spiking
    while True:
        if is_spiking:
            # Busy math computations
            x = 0.0001
            for i in range(100000):
                x += math.sqrt(x) + math.sin(x)
        else:
            time.sleep(0.1)

def start_cpu_stress():
    cores = multiprocessing.cpu_count()
    print(f"Launching {cores} CPU stress workers...")
    for _ in range(cores):
        t = threading.Thread(target=cpu_worker, daemon=True)
        t.start()

# ---------------------------------------------------------
# 3. MEMORY STRESSOR THREAD
# ---------------------------------------------------------
def memory_stressor():
    memory_blocks = []
    while True:
        if is_spiking:
            if not memory_blocks:
                print(">>> Memory Stress Active: Allocating buffers...")
                try:
                    # Allocate ~500MB per core up to 2GB to raise allocatable memory utilization
                    for i in range(8):
                        # 200MB block of chars
                        memory_blocks.append("x" * (200 * 1024 * 1024))
                        print(f"Allocated block {i+1} (200MB)")
                        time.sleep(1)
                except MemoryError:
                    print("!!! Out of Memory limit reached, holding current allocations.")
        else:
            if memory_blocks:
                print(">>> Memory Stress Inactive: Releasing buffers...")
                memory_blocks.clear()
                import gc
                gc.collect()
        time.sleep(1)

# ---------------------------------------------------------
# 4. DISK I/O STRESSOR THREAD (Writing to emptyDir volume)
# ---------------------------------------------------------
def disk_stressor():
    write_path = "/tmp/stress_test_file.bin"
    # If standard GKE ephemeral storage mount point is available
    if os.path.exists("/mnt/ephemeral"):
        write_path = "/mnt/ephemeral/stress_test_file.bin"
        
    print(f"Disk stressor using write path: {write_path}")
    block_size = 10 * 1024 * 1024  # 10MB chunk
    
    # Pre-generate 10MB random bytes
    dummy_data = os.urandom(block_size)
    
    while True:
        if is_spiking:
            try:
                # Continuously write blocks to generate heavy write bytes count
                with open(write_path, "wb") as f:
                    for _ in range(20):  # Write 200MB
                        f.write(dummy_data)
                        f.flush()
                        os.fsync(f.fileno())
                # Delete to avoid filling disk permanently
                if os.path.exists(write_path):
                    os.remove(write_path)
            except Exception as e:
                print(f"Disk write stress warning: {e}")
        else:
            # Clean up if existing
            if os.path.exists(write_path):
                try:
                    os.remove(write_path)
                except:
                    pass
            time.sleep(1)

# ---------------------------------------------------------
# MAIN CONTROL LOOP: Periodically toggle is_spiking flag
# ---------------------------------------------------------
if __name__ == "__main__":
    # Start worker threads
    start_cpu_stress()
    
    t_log = threading.Thread(target=log_generator, daemon=True)
    t_log.start()
    
    t_mem = threading.Thread(target=memory_stressor, daemon=True)
    t_mem.start()
    
    t_disk = threading.Thread(target=disk_stressor, daemon=True)
    t_disk.start()
    
    print("All simulator workers launched.")
    
    # Toggle states indefinitely
    try:
        while True:
            # Nominal State
            is_spiking = False
            print(f"STATE: NOMINAL (Next spike in {SPIKE_INTERVAL_SEC}s)")
            time.sleep(SPIKE_INTERVAL_SEC)
            
            # Spike/Stress State
            is_spiking = True
            print(f"STATE: SPIKE_STRESS_ACTIVE (Duration: {SPIKE_DURATION_SEC}s)")
            time.sleep(SPIKE_DURATION_SEC)
            
    except KeyboardInterrupt:
        print("Simulator terminating.")
