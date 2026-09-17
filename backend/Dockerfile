FROM python:3.11-slim
# Commit the image was built from; passed by docker compose as GIT_REVISION.
# Read with: docker image inspect app-backend --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
ARG GIT_REVISION=unknown
LABEL org.opencontainers.image.revision=$GIT_REVISION
WORKDIR /app

# System deps for OpenCV / image processing
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Install CPU-only PyTorch FIRST so requirements.txt doesn't pull the full CUDA wheel (~3-4 GB)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create storage dir if not mounted
RUN mkdir -p /app/storage

EXPOSE 8000
RUN chmod +x /app/entrypoint.sh
CMD ["/app/entrypoint.sh"]
