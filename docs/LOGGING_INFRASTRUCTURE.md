# Logging Infrastructure Setup

**Date:** 2026-05-27  
**Branch:** feat/setup-loki-grafana-logging  
**Status:** ✅ Complete

## Overview

Production-ready logging infrastructure với Loki + Grafana stack cho log aggregation và visualization.

## Architecture

```
API/Web Apps (Pino JSON logs)
    ↓
Promtail (log shipper)
    ↓
Loki (log aggregation)
    ↓
Grafana (visualization)
```

## Components

### 1. Loki (Port 3100)
- Log aggregation backend
- 7-day retention (168h)
- Filesystem storage
- Config: `infra/loki-config.yaml`

### 2. Promtail (Port 9080)
- Log shipper
- Scrapes Docker container logs
- Parses JSON logs from Pino
- Config: `infra/promtail-config.yaml`

### 3. Grafana (Port 3001)
- Visualization frontend
- Pre-configured Loki datasource
- Default dashboard: "Xuantoi API Logs"
- Credentials: admin/admin
- Config: `infra/grafana-datasources.yaml`, `infra/grafana-dashboards.yaml`

## Quick Start

### Start Infrastructure

```bash
cd infra
docker-compose -f docker-compose.dev.yml up -d
```

### Verify Services

```bash
# Check all services running
docker-compose -f docker-compose.dev.yml ps

# Check Loki health
curl http://localhost:3100/ready

# Check Grafana
open http://localhost:3001
```

### Access Grafana

1. Open http://localhost:3001
2. Login: admin/admin
3. Navigate to "Xuantoi API Logs" dashboard
4. View logs in real-time

## Dashboard Features

### Panels

1. **Log Volume by Level** - Logs/min grouped by level (info, warn, error)
2. **Log Volume by Module** - Logs/min grouped by module
3. **Error Logs** - Last 1h of error-level logs
4. **Warning Logs** - Last 1h of warn-level logs
5. **Security Module Logs** - All logs from security-* modules
6. **All Logs** - Full log stream with filters

### Query Examples

```logql
# All logs from API
{job="xuantoi"}

# Error logs only
{job="xuantoi", level="error"}

# Security module logs
{job="xuantoi", module=~"security.*"}

# Logs containing specific text
{job="xuantoi"} |= "rate limit"

# Count errors per minute
sum(count_over_time({job="xuantoi", level="error"} [1m]))
```

## Log Format

All logs follow Pino JSON structure:

```json
{
  "level": 30,
  "time": 1716835200000,
  "pid": 12345,
  "hostname": "api-server",
  "module": "security-abuse",
  "msg": "operation failed",
  "error": "Connection timeout"
}
```

### Log Levels

- `10` - trace
- `20` - debug
- `30` - info
- `40` - warn
- `50` - error
- `60` - fatal

## Configuration

### Loki Retention

Default: 7 days (168h)

Edit `infra/loki-config.yaml`:

```yaml
limits_config:
  retention_period: 168h  # Change this
```

### Log Volume Limits

Edit `infra/loki-config.yaml`:

```yaml
limits_config:
  ingestion_rate_mb: 16
  ingestion_burst_size_mb: 32
  per_stream_rate_limit: 8MB
```

### Promtail Scrape Paths

Edit `infra/promtail-config.yaml`:

```yaml
scrape_configs:
  - job_name: xuantoi-json
    static_configs:
      - targets:
          - localhost
        labels:
          job: xuantoi
          app: api
          __path__: /var/log/xuantoi/*.log  # Change this
```

## Troubleshooting

### Loki not receiving logs

```bash
# Check Promtail logs
docker logs xuantoi-promtail

# Check Loki logs
docker logs xuantoi-loki

# Verify Promtail can reach Loki
docker exec xuantoi-promtail wget -O- http://loki:3100/ready
```

### Grafana can't connect to Loki

```bash
# Check Loki is running
docker ps | grep loki

# Check Grafana datasource config
docker exec xuantoi-grafana cat /etc/grafana/provisioning/datasources/datasources.yaml

# Restart Grafana
docker-compose -f docker-compose.dev.yml restart grafana
```

### No logs in dashboard

1. Check API is running and logging
2. Verify log format is JSON (Pino)
3. Check Promtail scrape config matches log paths
4. Verify time range in Grafana (default: last 1h)

### High memory usage

Reduce retention or query limits in `loki-config.yaml`:

```yaml
limits_config:
  max_entries_limit_per_query: 5000  # Default: 10000
  max_query_series: 500              # Default: 1000
```

## Production Considerations

### Security

- [ ] Change Grafana admin password
- [ ] Enable Loki auth (`auth_enabled: true`)
- [ ] Use TLS for Loki/Grafana endpoints
- [ ] Restrict Grafana network access

### Scaling

- [ ] Use S3/GCS for Loki storage (not filesystem)
- [ ] Deploy Loki in microservices mode
- [ ] Add Loki read replicas
- [ ] Use external Postgres for Grafana

### Monitoring

- [ ] Add Prometheus metrics for Loki
- [ ] Alert on high error rates
- [ ] Alert on log ingestion failures
- [ ] Monitor Loki disk usage

## Resources

- [Loki Documentation](https://grafana.com/docs/loki/latest/)
- [Promtail Configuration](https://grafana.com/docs/loki/latest/clients/promtail/configuration/)
- [LogQL Query Language](https://grafana.com/docs/loki/latest/logql/)
- [Grafana Dashboards](https://grafana.com/docs/grafana/latest/dashboards/)

## Next Steps

1. ✅ Setup Loki + Grafana stack
2. ⏳ Configure API to write logs to file (for Promtail)
3. ⏳ Add alerting rules for critical errors
4. ⏳ Create additional dashboards (performance, security)
5. ⏳ Document log retention policy
