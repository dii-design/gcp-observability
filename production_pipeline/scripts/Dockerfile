FROM python:3.10-slim

WORKDIR /app

# Install system utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install dependencies (utilize PyTorch CPU-only pip configurations for speed and lighter image size)
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

# Copy serving and model logic
COPY model.py .
COPY serve_gnn.py .

# Expose port (Vertex AI custom container standard queries port 8080)
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn serve_gnn:app --host 0.0.0.0 --port $PORT"]
