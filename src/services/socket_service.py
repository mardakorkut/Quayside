"""
WebSocket Service for Real-time Vessel Updates
Handles SocketIO connections and events
"""
import logging
from flask_socketio import emit, join_room, leave_room
from datetime import datetime

logger = logging.getLogger(__name__)


class SocketService:
    """Handle WebSocket connections and real-time data streaming"""
    
    def __init__(self, socketio):
        self.socketio = socketio
        self.connected_users = {}
        self.vessel_subscriptions = {}
    
    def register_events(self):
        """Register all socket events"""
        self.socketio.on_event("connect")(self.handle_connect)
        self.socketio.on_event("disconnect")(self.handle_disconnect)
        self.socketio.on_event("subscribe_vessels")(self.handle_subscribe_vessels)
        self.socketio.on_event("unsubscribe_vessels")(self.handle_unsubscribe_vessels)
    
    def handle_connect(self):
        """Handle new client connection"""
        from flask import request
        client_id = request.sid
        self.connected_users[client_id] = {
            "connected_at": datetime.utcnow(),
            "subscriptions": []
        }
        logger.info(f"Client connected: {client_id}")
        emit("connection_response", {"data": "Connected to Vessel Tracker"})
    
    def handle_disconnect(self):
        """Handle client disconnection"""
        from flask import request
        client_id = request.sid
        if client_id in self.connected_users:
            del self.connected_users[client_id]
        logger.info(f"Client disconnected: {client_id}")
    
    def handle_subscribe_vessels(self, data):
        """Handle vessel subscription"""
        from flask import request
        client_id = request.sid
        
        bbox = data.get("bbox")  # {"min_lat", "min_lon", "max_lat", "max_lon"}
        
        if client_id not in self.vessel_subscriptions:
            self.vessel_subscriptions[client_id] = []
        
        self.vessel_subscriptions[client_id].append(bbox)
        logger.info(f"Client {client_id} subscribed to vessels in bbox: {bbox}")
    
    def handle_unsubscribe_vessels(self, data):
        """Handle vessel unsubscription"""
        from flask import request
        client_id = request.sid
        
        if client_id in self.vessel_subscriptions:
            self.vessel_subscriptions[client_id].clear()
    
    def broadcast_vessel_update(self, vessel_data: dict):
        """Broadcast vessel update to all connected clients"""
        emit(
            "vessel_update",
            {"vessel": vessel_data},
            broadcast=True
        )
    
    def broadcast_vessels_batch(self, vessels: list):
        """Broadcast multiple vessel updates"""
        emit(
            "vessels_update",
            {"vessels": vessels},
            broadcast=True
        )
    
    def send_error(self, message: str):
        """Send error message to client"""
        emit("error", {"message": message})
