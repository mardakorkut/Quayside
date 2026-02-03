"""
AIS WebSocket Service for real-time vessel tracking
Connects to AISStream.io WebSocket API
"""
import asyncio
import websockets
import json
import logging
from typing import Dict, Optional, Callable
import os

logger = logging.getLogger(__name__)


class AISWebSocketService:
    """WebSocket service for real-time AIS data from AISStream.io"""
    
    WS_URL = "wss://stream.aisstream.io/v0/stream"
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv("AISSTREAM_API_KEY")
        if not self.api_key:
            raise ValueError("AISSTREAM_API_KEY not configured")
        
        self.websocket = None
        self.is_connected = False
        self.vessel_cache = {}  # Cache vessels by MMSI
        
    async def connect(self, bbox: List[List[float]] = None, mmsi_filter: List[str] = None):
        """
        Connect to AISStream WebSocket
        
        Args:
            bbox: Bounding boxes [[lat1, lon1], [lat2, lon2]]
            mmsi_filter: List of MMSI numbers to filter
        """
        try:
            logger.info(f"Connecting to {self.WS_URL}...")
            self.websocket = await websockets.connect(self.WS_URL)
            
            # Default to world coverage if no bbox specified
            if bbox is None:
                bbox = [[[-90, -180], [90, 180]]]
            
            # Prepare subscription message
            subscription = {
                "APIKey": self.api_key,
                "BoundingBoxes": bbox,
                "FilterMessageTypes": ["PositionReport", "ShipStaticData"]
            }
            
            # Add MMSI filter if specified
            if mmsi_filter:
                subscription["FiltersShipMMSI"] = mmsi_filter
            
            # Send subscription
            await self.websocket.send(json.dumps(subscription))
            self.is_connected = True
            logger.info("✅ Connected to AISStream WebSocket")
            
        except Exception as e:
            logger.error(f"❌ Failed to connect to AISStream: {e}")
            self.is_connected = False
            raise
    
    async def listen(self, callback: Callable[[Dict], None]):
        """
        Listen for incoming AIS messages
        
        Args:
            callback: Function to call with each message
        """
        if not self.is_connected:
            raise ConnectionError("Not connected to WebSocket")
        
        try:
            async for message_json in self.websocket:
                try:
                    message = json.loads(message_json)
                    message_type = message.get("MessageType")
                    
                    if message_type == "PositionReport":
                        vessel_data = self._parse_position_report(message)
                        if vessel_data:
                            self.vessel_cache[vessel_data["mmsi"]] = vessel_data
                            await callback(vessel_data)
                    
                    elif message_type == "ShipStaticData":
                        vessel_data = self._parse_static_data(message)
                        if vessel_data:
                            # Merge with existing position data if available
                            mmsi = vessel_data["mmsi"]
                            if mmsi in self.vessel_cache:
                                self.vessel_cache[mmsi].update(vessel_data)
                            else:
                                self.vessel_cache[mmsi] = vessel_data
                            await callback(self.vessel_cache[mmsi])
                    
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse message: {e}")
                    continue
                    
        except websockets.exceptions.ConnectionClosed:
            logger.warning("WebSocket connection closed")
            self.is_connected = False
        except Exception as e:
            logger.error(f"Error in WebSocket listener: {e}")
            raise
    
    def _parse_position_report(self, message: Dict) -> Optional[Dict]:
        """Parse PositionReport message"""
        try:
            metadata = message.get("MetaData", {})
            ais_msg = message.get("Message", {}).get("PositionReport", {})
            
            return {
                "mmsi": str(metadata.get("MMSI") or ais_msg.get("UserID")),
                "name": metadata.get("ShipName", "Unknown"),
                "latitude": metadata.get("latitude") or ais_msg.get("Latitude"),
                "longitude": metadata.get("longitude") or ais_msg.get("Longitude"),
                "speed": ais_msg.get("Sog", 0),
                "heading": ais_msg.get("Cog", 0) or ais_msg.get("TrueHeading", 0),
                "timestamp": metadata.get("time_utc"),
            }
        except Exception as e:
            logger.error(f"Error parsing position report: {e}")
            return None
    
    def _parse_static_data(self, message: Dict) -> Optional[Dict]:
        """Parse ShipStaticData message"""
        try:
            metadata = message.get("MetaData", {})
            ais_msg = message.get("Message", {}).get("ShipStaticData", {})
            
            return {
                "mmsi": str(metadata.get("MMSI") or ais_msg.get("UserID")),
                "name": ais_msg.get("Name", "Unknown").strip(),
                "callsign": ais_msg.get("CallSign", "").strip(),
                "destination": ais_msg.get("Destination", "").strip(),
                "ship_type": self._get_ship_type_name(ais_msg.get("Type", 0)),
                "imo": ais_msg.get("ImoNumber"),
            }
        except Exception as e:
            logger.error(f"Error parsing static data: {e}")
            return None
    
    def _get_ship_type_name(self, type_code: int) -> str:
        """Convert ship type code to readable name"""
        ship_types = {
            70: "Cargo Ship",
            71: "Cargo Ship - Hazardous",
            72: "Cargo Ship - Hazardous",
            73: "Cargo Ship - Hazardous",
            74: "Cargo Ship - Hazardous",
            80: "Tanker",
            81: "Tanker - Hazardous",
            82: "Tanker - Hazardous",
            83: "Tanker - Hazardous",
            84: "Tanker - Hazardous",
            30: "Fishing",
            31: "Towing",
            32: "Towing - Large",
            33: "Dredger",
            34: "Diving Ops",
            35: "Military Ops",
            36: "Sailing",
            37: "Pleasure Craft",
            50: "Pilot Vessel",
            51: "Search and Rescue",
            52: "Tug",
            53: "Port Tender",
            54: "Anti-pollution",
            55: "Law Enforcement",
            60: "Passenger",
            61: "Passenger - Hazardous",
            62: "Passenger - Hazardous",
            63: "Passenger - Hazardous",
            64: "Passenger - Hazardous",
        }
        return ship_types.get(type_code, f"Type {type_code}")
    
    async def search_vessel_by_name(self, ship_name: str) -> List[Dict]:
        """
        Search for vessels by name in cache
        
        Args:
            ship_name: Vessel name to search
            
        Returns:
            List of matching vessels
        """
        results = []
        search_name = ship_name.upper().strip()
        
        for vessel in self.vessel_cache.values():
            vessel_name = vessel.get("name", "").upper().strip()
            if search_name in vessel_name:
                results.append(vessel)
        
        return results
    
    async def get_vessel_by_mmsi(self, mmsi: str) -> Optional[Dict]:
        """
        Get vessel by MMSI from cache
        
        Args:
            mmsi: MMSI number
            
        Returns:
            Vessel data or None
        """
        return self.vessel_cache.get(mmsi)
    
    async def disconnect(self):
        """Close WebSocket connection"""
        if self.websocket:
            await self.websocket.close()
            self.is_connected = False
            logger.info("WebSocket disconnected")
