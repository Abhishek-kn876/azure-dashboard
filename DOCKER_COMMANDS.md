# Docker Commands Reference

Quick reference for running and managing the azure-dashboard stack (mongodb, backend, frontend).

Run all commands from the project root (where `docker-compose.yml` lives). Make sure `.env` is filled in first — copy `.env.example` to `.env` and set real values.

## Setup

```bash
# Copy the template and fill in real credentials
cp .env.example .env
```

## Build

```bash
# Build (or rebuild) all images
docker compose build

# Build without using cache
docker compose build --no-cache

# Build a single service
docker compose build backend
docker compose build frontend
```

## Start

```bash
# Start all services in the background
docker compose up -d

# Build and start in one step
docker compose up -d --build

# Start a single service
docker compose up -d backend
```

The dashboard will be available at http://localhost:8080, and the backend API at http://localhost:3000.

## Stop

```bash
# Stop and remove containers (keeps volumes, e.g. mongo data)
docker compose down

# Stop containers without removing them
docker compose stop

# Stop and remove containers + volumes (WARNING: deletes MongoDB data)
docker compose down -v
```

## Restart

```bash
# Restart all services
docker compose restart

# Restart a single service
docker compose restart backend
```

## Status & Health

```bash
# List running containers for this project
docker compose ps

# Check container resource usage
docker stats azure-dashboard-backend azure-dashboard-frontend azure-dashboard-mongodb
```

## Logs

```bash
# Tail logs for all services
docker compose logs -f

# Tail logs for a single service
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mongodb

# Last 100 lines only
docker compose logs --tail=100 backend
```

## Shell Access

```bash
# Open a shell inside a running container
docker exec -it azure-dashboard-backend sh
docker exec -it azure-dashboard-frontend sh

# Open a mongo shell
docker exec -it azure-dashboard-mongodb mongosh
```

## Cleanup

```bash
# Remove stopped containers, unused networks, dangling images
docker system prune

# Remove this project's images
docker rmi azure-dashboard-backend azure-dashboard-frontend

# Remove everything unused (including unused volumes) - use with caution
docker system prune -a --volumes
```

## Images

```bash
# List images for this project
docker images | grep azure-dashboard
```
