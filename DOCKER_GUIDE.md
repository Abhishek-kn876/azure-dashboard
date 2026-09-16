# Azure Metrics Dashboard — Docker Guide

## Architecture

Three containers run on a shared `dashboard-net` network:

| Container | Image | Port |
|---|---|---|
| `azure-dashboard-mongodb` | `mongo:7` | internal only |
| `azure-dashboard-backend` | `azure-metrics-dashboard-backend` | `3000 → 3000` |
| `azure-dashboard-frontend` | `azure-metrics-dashboard-frontend` | `8080 → 80` |

Nginx (frontend) proxies all `/api/*` calls to the backend. The backend connects to MongoDB using the internal hostname `mongodb`.

---

## Quick Start

### 1. Build all images
```powershell
docker-compose build
```

### 2. Start all containers (detached)
```powershell
docker-compose up -d
```

### 3. Access the application
Open your browser and go to: **http://localhost:8080**

Login credentials:
- **Username:** `admin`
- **Password:** `admin123`

---

## Stop the Application

### Stop containers (keep data)
```powershell
docker-compose stop
```

### Stop AND remove containers (keep volume data)
```powershell
docker-compose down
```

### Stop AND remove containers + all data volumes (full reset)
```powershell
docker-compose down -v
```

---

## Rebuild the Application

Use this after making code changes:

```powershell
# Rebuild images and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

Or rebuild a single service only:
```powershell
docker-compose build backend
docker-compose up -d --no-deps backend
```

---

## View Logs

### All services (live tail)
```powershell
docker-compose logs -f
```

### Specific service
```powershell
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f mongodb
```

---

## Check Container Status

```powershell
docker-compose ps
```

Expected output when healthy:
```
NAME                       IMAGE                              STATUS
azure-dashboard-backend    azure-metrics-dashboard-backend    Up X seconds
azure-dashboard-frontend   azure-metrics-dashboard-frontend   Up X seconds
azure-dashboard-mongodb    mongo:7                            Up X seconds (healthy)
```

---

## Useful Docker Commands

### Open a shell inside a container
```powershell
docker exec -it azure-dashboard-backend sh
docker exec -it azure-dashboard-mongodb mongosh
```

### Inspect container resource usage
```powershell
docker stats
```

### Remove unused images/cache (free up disk space)
```powershell
docker system prune -f
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Port 8080 already in use | Change `"8080:80"` to `"8081:80"` in `docker-compose.yml` |
| Port 3000 already in use | Change `"3000:3000"` to `"3001:3000"` in `docker-compose.yml` |
| Backend can't reach MongoDB | Check `MONGO_URI=mongodb://mongodb:27017` in `.env` |
| Container keeps restarting | Run `docker-compose logs backend` to see error details |
| Stale build cache | Run `docker-compose build --no-cache` |
