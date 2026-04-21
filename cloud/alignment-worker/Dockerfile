# Alignment worker — Whisper + DTW for cloud-sourced audiobooks.
#
# Base image ships with ffmpeg (for chunking) and Python 3.11. GPU drivers
# are provided by Cloud Run's GPU runtime; nothing extra is needed here.

FROM python:3.11-slim-bookworm

RUN apt-get update && \
    apt-get install --no-install-recommends -y \
        ffmpeg \
        git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Whisper will download model weights on first use; persist them to a volume
# mounted at /models so cold starts don't redownload every time.
ENV WHISPER_MODEL=small
ENV WHISPER_CACHE=/models

# Cloud Run sends a POST to this port with the job spec.
ENV PORT=8080
EXPOSE 8080

CMD ["python", "-u", "main.py"]
