# Kuumba Code Relay Server

A lightweight WebSocket relay server for end-to-end encrypted device communication. The relay cannot read messages—all payloads remain encrypted between devices.

## Quick Start

Run locally in development:

```bash
cd apps/relay
npm install
npm start
```

The server listens on `http://localhost:4400` by default. Override with `RELAY_PORT=5000 npm start`.

## Docker Deployment

Build and run the Docker image:

```bash
# Build
docker build -t kuumba-relay:latest .

# Run
docker run -d \
  --name kuumba-relay \
  -p 4400:4400 \
  -e RELAY_PORT=4400 \
  kuumba-relay:latest
```

View logs:

```bash
docker logs -f kuumba-relay
```

## VPS Setup (DigitalOcean $5 Droplet)

### Prerequisites

- Ubuntu 24.04 droplet (4GB RAM, 2 vCPU recommended)
- Root SSH access
- Domain name pointing to VPS IP

### Installation

1. **Create and connect to droplet**

   ```bash
   ssh root@your-vps-ip
   ```

2. **Install Node.js 22**

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get update
   sudo apt-get install -y nodejs git nginx certbot python3-certbot-nginx
   ```

3. **Clone repo (or copy relay files)**

   ```bash
   cd /opt
   git clone https://github.com/yourusername/kuumba-code.git
   cd kuumba-code/apps/relay
   npm install --production
   ```

4. **Set up systemd service**

   Create `/etc/systemd/system/kuumba-relay.service`:

   ```ini
   [Unit]
   Description=Kuumba Code Relay Server
   After=network.target

   [Service]
   Type=simple
   User=www-data
   WorkingDirectory=/opt/kuumba-code/apps/relay
   ExecStart=/usr/bin/node src/index.ts
   Restart=on-failure
   RestartSec=5s
   Environment="RELAY_PORT=4400"

   [Install]
   WantedBy=multi-user.target
   ```

   Enable and start:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable kuumba-relay
   sudo systemctl start kuumba-relay
   sudo systemctl status kuumba-relay
   ```

   View logs:

   ```bash
   sudo journalctl -u kuumba-relay -f
   ```

### Alternative: Docker on VPS

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Run relay
docker run -d \
  --name kuumba-relay \
  --restart always \
  -p 4400:4400 \
  kuumba-relay:latest
```

## SSL/TLS Setup (Nginx Reverse Proxy)

The relay must use WSS (secure WebSocket) in production. Set up Nginx as a reverse proxy with Let's Encrypt.

### 1. Configure Nginx

Create `/etc/nginx/sites-available/relay.kuumbacode.com`:

```nginx
upstream relay_backend {
    server localhost:4400;
}

server {
    listen 80;
    server_name relay.kuumbacode.com;

    location / {
        proxy_pass http://relay_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/relay.kuumbacode.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 2. Get SSL Certificate

```bash
sudo certbot certonly --nginx -d relay.kuumbacode.com
```

Certbot will update your Nginx config automatically with SSL settings.

### 3. Verify SSL

```bash
curl https://relay.kuumbacode.com/health
```

Expected response:

```json
{ "status": "ok", "devices": 0, "pairings": 0 }
```

### 4. Auto-Renew Certificates

Certbot sets up auto-renewal by default. Verify:

```bash
sudo certbot renew --dry-run
```

## Domain Setup

Point your domain to the VPS:

1. Get your VPS's public IP:

   ```bash
   curl ifconfig.me
   ```

2. Update DNS records at your domain registrar:
   - **A record**: `relay.kuumbacode.com` → `your-vps-ip`
   - Wait 5-10 minutes for DNS propagation

3. Verify DNS:
   ```bash
   nslookup relay.kuumbacode.com
   ```

## Configuration

### Environment Variables

| Variable     | Default | Description               |
| ------------ | ------- | ------------------------- |
| `RELAY_PORT` | `4400`  | Port the relay listens on |

Example:

```bash
RELAY_PORT=5000 npm start
```

## Health Check

The relay exposes a health endpoint for monitoring:

**Endpoint**: `GET /health`

**Response**:

```json
{
  "status": "ok",
  "devices": 42,
  "pairings": 128
}
```

Use this for uptime monitoring services (Uptimerobot, Grafana, etc.).

## Security Notes

- **Encryption**: The relay cannot read message payloads. All messages are E2E encrypted between devices.
- **Rate Limiting**: Limited to 20 WebSocket connections per IP per minute. Clients exceeding this are rejected with code 4029.
- **WSS Required**: Always use WSS (TLS) in production. HTTP WebSocket connections are insecure.
- **IP Forwarding**: The relay respects `X-Forwarded-For` headers when behind a reverse proxy (Nginx, load balancer).

## Troubleshooting

### High CPU usage

- Check `journalctl -u kuumba-relay` for errors
- Verify Nginx proxy settings include proper timeouts

### Connection refused

- Ensure port 4400 is open: `sudo ufw allow 4400`
- Check firewall rules on your VPS provider

### SSL certificate errors

- Verify domain is pointing to VPS: `nslookup relay.kuumbacode.com`
- Check Certbot logs: `sudo certbot renew -v`

### Device disconnections

- May be due to rate limiting. Check client IP in logs.
- Verify proxy `X-Forwarded-For` header is set correctly in Nginx.

## Monitoring

Monitor the relay with:

```bash
# Health check loop
watch -n 5 'curl -s https://relay.kuumbacode.com/health | jq'

# Log tail
sudo journalctl -u kuumba-relay -f

# System resources
htop
```

## Production Checklist

- [ ] Domain configured (A record pointing to VPS)
- [ ] SSL certificate installed and auto-renewal enabled
- [ ] Systemd service running and enabled
- [ ] Firewall allows port 80 (HTTP) and 443 (HTTPS)
- [ ] Health endpoint responding
- [ ] Nginx logs show successful proxying
- [ ] Rate limiting parameters acceptable for expected load
