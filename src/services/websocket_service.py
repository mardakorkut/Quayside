"""
FastAPI WebSocket Service
Manages real-time connections and broadcasts vessel data
"""
import logging
from typing import Dict, Set, Optional, List
from fastapi import WebSocket
from datetime import datetime

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Manage WebSocket connections and broadcasts"""
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.subscriptions: Dict[str, Set[str]] = {}  # connection_id -> set of bboxes
    
    async def connect(self, websocket: WebSocket, client_id: str):
        """Accept and register a new WebSocket connection"""
        await websocket.accept()
        self.active_connections[client_id] = websocket
        self.subscriptions[client_id] = set()
        logger.info(f"✅ Client connected: {client_id}")
        
        # Send welcome message
        await websocket.send_json({
            "type": "connection",
            "message": "Connected to Vessel Tracker",
            "timestamp": datetime.utcnow().isoformat()
        })
    
    async def disconnect(self, websocket: WebSocket):
        """Unregister a disconnected client"""
        for client_id, conn in list(self.active_connections.items()):
            if conn == websocket:
                del self.active_connections[client_id]
                if client_id in self.subscriptions:
                    del self.subscriptions[client_id]
                logger.info(f"❌ Client disconnected: {client_id}")
                break
    
    async def disconnect_all(self):
        """Close all connections"""
        for websocket in self.active_connections.values():
            try:
                await websocket.close()
            except Exception as e:
                logger.error(f"Error closing connection: {e}")
        self.active_connections.clear()
        self.subscriptions.clear()
    
    async def subscribe_to_bbox(self, websocket: WebSocket, bbox: Optional[str] = None):
        """Subscribe client to vessel updates in a bounding box"""
        for client_id, conn in self.active_connections.items():
            if conn == websocket:
                if bbox:
                    self.subscriptions[client_id].add(bbox)
                    await websocket.send_json({
                        "type": "subscribed",
                        "bbox": bbox,
                        "message": f"Subscribed to bbox: {bbox}"
                    })
                    logger.info(f"📍 Client {client_id} subscribed to {bbox}")
                break
    
    async def unsubscribe_from_bbox(self, websocket: WebSocket):
        """Unsubscribe client from vessel updates"""
        for client_id, conn in self.active_connections.items():
            if conn == websocket:
                self.subscriptions[client_id].clear()
                await websocket.send_json({
                    "type": "unsubscribed",
                    "message": "Unsubscribed from updates"
                })
                logger.info(f"Unsubscribed: {client_id}")
                break
    
    async def broadcast_vessel(self, vessel_data: dict):
        """Broadcast vessel update to all connected clients"""
        disconnected = []
        
        for client_id, connection in self.active_connections.items():
            try:
                await connection.send_json({
                    "type": "vessel_update",
                    "vessel": vessel_data,
                    "timestamp": datetime.utcnow().isoformat()
                })
            except Exception as e:
                logger.error(f"Error sending to {client_id}: {e}")
                disconnected.append(client_id)
        
        # Remove disconnected clients
        for client_id in disconnected:
            await self.disconnect(self.active_connections.get(client_id))
    
    async def broadcast_vessels(self, vessels: List[dict]):
        """Broadcast multiple vessels to all connected clients"""
        disconnected = []
        
        for client_id, connection in self.active_connections.items():
            try:
                await connection.send_json({
                    "type": "vessels_update",
                    "vessels": vessels,
                    "count": len(vessels),
                    "timestamp": datetime.utcnow().isoformat()
                })
            except Exception as e:
                logger.error(f"Error sending to {client_id}: {e}")
                disconnected.append(client_id)
        
        # Remove disconnected clients
        for client_id in disconnected:
            await self.disconnect(self.active_connections.get(client_id))
    
    async def send_to_client(self, websocket: WebSocket, data: dict):
        """Send data to specific client"""
        try:
            await websocket.send_json(data)
        except Exception as e:
            logger.error(f"Error sending to client: {e}")
            await self.disconnect(websocket)
    
    async def broadcast_error(self, message: str):
        """Broadcast error message to all clients"""
        for connection in self.active_connections.values():
            try:
                await connection.send_json({
                    "type": "error",
                    "message": message,
                    "timestamp": datetime.utcnow().isoformat()
                })
            except Exception as e:
                logger.error(f"Error broadcasting error: {e}")
    
    def get_connection_count(self) -> int:
        """Get number of active connections"""
        return len(self.active_connections)
