"""
Quayside - Smart Vessel Tracking Platform
Real-time Maritime Intelligence for Brokers
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from src.services.ais_service import AISStreamService
from src.services.websocket_service import WebSocketManager
from src.services.ais_websocket_service import get_ais_proxy
from src.routes import vessel_routes, auth_routes

# Setup logging
logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger(__name__)

# WebSocket manager for handling connections
ws_manager = WebSocketManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup/shutdown events
    """
    # Startup
    logger.info("🚀 Quayside Server Starting...")
    logger.info(f"Environment: {settings.ENV}")
    logger.info(f"Debug Mode: {settings.DEBUG}")
    
    # Initialize DB tables
    from src.database import init_db
    init_db()
    
    # Start AIS Proxy automatically
    if settings.AISSTREAM_API_KEY:
        proxy = get_ais_proxy(settings.AISSTREAM_API_KEY)
        # Set callback to broadcast to main websocket manager
        proxy.message_callback = ws_manager.broadcast_vessel
        asyncio.create_task(proxy.start())
        logger.info("🚀 AIS Proxy started automatically")
    else:
        logger.warning("⚠️ AISSTREAM_API_KEY not set, live tracking will not work")
    
    yield
    
    # Shutdown
    logger.info("⛔ Quayside Server Shutting Down...")
    
    # Stop AIS proxy
    if settings.AISSTREAM_API_KEY:
        proxy = get_ais_proxy(settings.AISSTREAM_API_KEY)
        if proxy.is_running:
            await proxy.stop()
            
    await ws_manager.disconnect_all()



# Create FastAPI app
app = FastAPI(
    title=settings.API_TITLE,
    description=settings.API_DESCRIPTION,
    version=settings.API_VERSION,
    lifespan=lifespan,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
    allow_methods=settings.CORS_ALLOW_METHODS,
    allow_headers=settings.CORS_ALLOW_HEADERS,
)

# Mount static files
if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")

# Include routers
app.include_router(vessel_routes.router, prefix="/api", tags=["vessels"])
app.include_router(auth_routes.router)  # Auth routes already have /api/auth prefix





@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve main page"""
    try:
        with open("templates/index.html", "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return "<h1>Welcome to Vessel Tracker API</h1><p>Visit /docs for API documentation</p>"


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "environment": settings.ENV,
        "service": "Real-time Vessel Tracker",
    }


# ==================== WEBSOCKET ENDPOINTS ====================

# AIS Stream proxy endpoint
@app.websocket("/ws/ais-stream")
async def websocket_ais_stream(websocket: WebSocket):
    """
    WebSocket endpoint for AIS Stream proxy
    Receives live vessel data from AISStream.io and forwards to client
    """
    await websocket.accept()
    
    # Get AIS proxy instance
    proxy = get_ais_proxy(settings.AISSTREAM_API_KEY)
    await proxy.add_client(websocket)
    
    # Start proxy if not running
    if not proxy.is_running:
        asyncio.create_task(proxy.start())
    
    try:
        # Keep connection alive
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                
    except WebSocketDisconnect:
        await proxy.remove_client(websocket)
        logger.info("AIS Stream client disconnected")
    except Exception as e:
        logger.error(f"AIS WebSocket error: {e}")
        await proxy.remove_client(websocket)

@app.websocket("/ws/vessels")
async def websocket_vessel_endpoint(
    websocket: WebSocket,
    bbox: str = Query(default=None)
):
    """
    WebSocket endpoint for real-time vessel tracking
    
    Connect with: ws://localhost:5000/ws/vessels?bbox=min_lat,min_lon,max_lat,max_lon
    
    Example: ws://localhost:5000/ws/vessels?bbox=40.0,27.0,42.0,30.0
    """
    await ws_manager.connect(websocket, client_id=websocket.client[0])
    
    try:
        while True:
            # Receive messages from client
            data = await websocket.receive_json()
            
            if data.get("type") == "subscribe":
                await ws_manager.subscribe_to_bbox(
                    websocket, 
                    bbox=data.get("bbox")
                )
            
            elif data.get("type") == "unsubscribe":
                await ws_manager.unsubscribe_from_bbox(websocket)
            
            elif data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
        logger.info(f"Client disconnected: {websocket.client[0]}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await ws_manager.disconnect(websocket)


# ==================== BACKGROUND TASKS ====================

@app.post("/api/admin/start-tracking")
async def start_tracking(
    min_lat: float = Query(...),
    min_lon: float = Query(...),
    max_lat: float = Query(...),
    max_lon: float = Query(...),
):
    """
    Admin endpoint to start vessel tracking in a specific area
    This would trigger background tasks to fetch and broadcast vessel data
    """
    try:
        # TODO: Implement background task to periodically fetch vessels
        return {
            "status": "started",
            "bbox": {
                "min_lat": min_lat,
                "min_lon": min_lon,
                "max_lat": max_lat,
                "max_lon": max_lon,
            }
        }
    except Exception as e:
        return {"error": str(e)}, 500


if __name__ == "__main__":
    import uvicorn
    
    # Run server with Uvicorn
    uvicorn.run(
        "app:app",
        host=settings.HOST,
        port=settings.PORT,
        workers=settings.WORKERS if settings.ENV == "production" else 1,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower(),
    )