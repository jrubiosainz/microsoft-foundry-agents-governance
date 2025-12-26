from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
import sys

# Add backend directory to path to import foundry_client if needed, 
# but since we are in the same package, relative import might work or just standard import
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from foundry_client import FoundryClient
from pydantic import BaseModel

app = FastAPI()

# Serve Static Files (CSS, JS, Images)
static_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "static")
app.mount("/static", StaticFiles(directory=static_path), name="static")

# API Endpoints
@app.get("/api/subscriptions")
async def get_subscriptions():
    try:
        client = FoundryClient() # No endpoint needed
        return client.get_subscriptions()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/resources/{subscription_id}")
async def get_resources(subscription_id: str):
    try:
        client = FoundryClient()
        return client.get_foundry_resources(subscription_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/agents")
async def get_agents(project_endpoint: str, project_id: str = None):
    if not project_endpoint:
        raise HTTPException(status_code=400, detail="Project Endpoint is required")
    
    try:
        client = FoundryClient(project_endpoint=project_endpoint)
        # get_agents now returns parsed agents with access info
        agents = client.get_agents(project_id=project_id)
        return agents
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/access/{resource_id:path}")
async def get_access(resource_id: str):
    try:
        # We need a client, but endpoint doesn't matter for this call
        client = FoundryClient(project_endpoint="dummy")
        # resource_id comes with /subscriptions/..., so we prepend nothing or handle it
        # The client.get_role_assignments expects the full ID starting with /subscriptions
        # FastAPI path param might strip leading slash? Let's check.
        # Usually {resource_id:path} captures everything.
        # If the client sends "subscriptions/...", we need to add "/"
        if not resource_id.startswith("/"):
            resource_id = "/" + resource_id
            
        assignments = client.get_role_assignments(resource_id)
        return assignments
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Serve Frontend
@app.get("/")
async def read_index():
    index_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "index.html")
    return FileResponse(index_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
