# Infrastructure Inspection App

AI-powered drone inspection platform for infrastructure assets. Detects defects in bridges, roads, towers, and pipelines using YOLO-based computer vision.

## Stack

| Layer     | Technology                        |
|-----------|-----------------------------------|
| Frontend  | Next.js 14, React Query, Tailwind |
| Backend   | FastAPI, SQLAlchemy, PyTorch      |
| ML        | YOLOv8 (defect detection)         |
| Database  | SQLite (dev) / PostgreSQL (prod)  |
| Storage   | Local (dev) / S3 (prod)           |
| Deploy    | Docker + EC2 + Nginx              |

## Local Development

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env      # edit as needed
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev               # http://localhost:3000
```

## Docker (Production)

```bash
cp backend/.env.example backend/.env   # fill in SECRET_KEY etc.
docker compose up -d --build
# App available at http://localhost:80
```

## EC2 Deployment

1. Launch EC2 instance (Ubuntu 22.04, t3.medium or larger)
2. Install Docker: `sudo apt install docker.io docker-compose-plugin -y`
3. Clone repo and run `docker compose up -d --build`
4. Open ports 80 (HTTP) and 22 (SSH) in the Security Group

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── core/         # Auth, config, deps
│   │   ├── models/       # SQLAlchemy models
│   │   ├── routers/      # API endpoints
│   │   ├── schemas/      # Pydantic schemas
│   │   └── services/     # ML inference, business logic
│   ├── ml_models/        # YOLO weights (not committed)
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── app/              # Next.js App Router pages
│   ├── components/       # Reusable UI components
│   ├── lib/              # API client, utilities
│   ├── Dockerfile
│   └── next.config.js
├── nginx/
│   └── nginx.conf        # Reverse proxy config
├── docker-compose.yml     # Production
└── docker-compose.dev.yml # Local dev
```
