FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code
COPY . .

# Run Alembic migrations and start the application
# --proxy-headers: take the client IP from nginx's X-Forwarded-For (needed for
# per-IP rate limiting; otherwise every request looks like it comes from the
# nginx container). Trusting any sender ("*") is only safe because the
# backend port is not published; see docker-compose.yml. Override with
# FORWARDED_ALLOW_IPS=<nginx ip/cidr> if you expose it.
CMD sh -c "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips=\"${FORWARDED_ALLOW_IPS:-*}\""
