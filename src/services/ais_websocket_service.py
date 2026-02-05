"""

AIS Stream WebSocket Proxy Service
Connects to AISStream.io and forwards data to frontend clients
"""
import asyncio
import json
import logging
from typing import Set
import websockets
from fastapi import WebSocket

logger = logging.getLogger(__name__)

class AISWebSocketProxy:
    """Proxy service for AISStream.io WebSocket"""
    
    def __init__(self, api_key: str, message_callback=None):
        self.api_key = api_key
        self.ais_websocket = None
        self.clients: Set[WebSocket] = set()
        self.is_running = False
        self.ship_static_data = {}  # Cache for ship static data (MMSI -> ShipType, etc.)
        self.message_callback = message_callback


    def _parse_draught(self, value):
        try:
            if value is None or value == '':
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    def _normalize_ship_type(self, ship_type):
        if ship_type is None or ship_type == 'Unknown':
            return None, 'Other'

        try:
            if isinstance(ship_type, (int, float)) or str(ship_type).isdigit():
                code = int(ship_type)
                if 80 <= code <= 89:
                    return f"Tanker ({code})", 'Tanker'
                if 70 <= code <= 79:
                    return f"Cargo ({code})", 'Cargo'
                if 60 <= code <= 69:
                    return f"Passenger ({code})", 'Passenger'
                if 30 <= code <= 39:
                    return f"Fishing ({code})", 'Fishing'
                if 40 <= code <= 49:
                    return f"Tug ({code})", 'Tug'
                if 50 <= code <= 59:
                    return f"Pilot ({code})", 'Pilot'
                return f"Type {code}", 'Other'
        except (TypeError, ValueError):
            pass

        ship_type_str = str(ship_type).strip()
        ship_type_lower = ship_type_str.lower()

        if 'tanker' in ship_type_lower or 'lng' in ship_type_lower or 'lpg' in ship_type_lower:
            return ship_type_str, 'Tanker'
        if 'container' in ship_type_lower:
            return ship_type_str, 'Container'
        if 'cargo' in ship_type_lower or 'bulk' in ship_type_lower or 'general' in ship_type_lower:
            return ship_type_str, 'Cargo'
        if 'passenger' in ship_type_lower:
            return ship_type_str, 'Passenger'

        return ship_type_str, 'Other'
        
    async def connect_to_aisstream(self):
        """Connect to AISStream.io WebSocket"""
        try:
            logger.info("🔌 Connecting to AISStream.io...")
            self.ais_websocket = await websockets.connect(
                'wss://stream.aisstream.io/v0/stream'
            )
            logger.info("✅ Connected to AISStream.io")
            
            # Subscribe to global region (all vessels)
            subscription = {
                'APIKey': self.api_key,
                'BoundingBoxes': [[[-90, -180], [90, 180]]],
                'FilterMessageTypes': ['PositionReport', 'ShipStaticData']  # Add ShipStaticData
            }
            
            await self.ais_websocket.send(json.dumps(subscription))
            logger.info("📡 Subscription sent to AISStream.io")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to connect to AISStream: {e}")
            return False
    
    async def forward_ais_data(self):
        """Receive data from AISStream and forward to clients"""
        try:
            async for message in self.ais_websocket:
                if not self.clients:
                    continue
                    
                # Parse AIS message
                data = json.loads(message)
                
                # Handle Ship Static Data messages (contains ShipType)
                if data.get('MessageType') == 'ShipStaticData':
                    meta_data = data.get('MetaData', {})
                    static_data = data['Message']['ShipStaticData']
                    mmsi = meta_data.get('MMSI')
                    
                    if mmsi:
                        # Cache ship type and other static data
                        self.ship_static_data[mmsi] = {
                            'ship_type': static_data.get('Type'),
                            'ship_name': static_data.get('Name'),
                            'callsign': static_data.get('CallSign'),
                            'destination': static_data.get('Destination'),
                            'draught': static_data.get('MaximumStaticDraught')  # Draught from static data
                        }
                        logger.debug(f"📋 Static Data for MMSI {mmsi}: Type={static_data.get('Type')}, Name={static_data.get('Name')}, Draught={static_data.get('MaximumStaticDraught')}")
                    continue
                
                if data.get('MessageType') == 'PositionReport':
                    ais_data = data['Message']['PositionReport']
                    meta_data = data['MetaData']
                    mmsi = meta_data.get('MMSI')
                    
                    # Get ship type from cache if available, otherwise from metadata
                    raw_ship_type = None
                    cached_draught = None
                    ship_name = meta_data.get('ShipName', '')
                    
                    if mmsi and mmsi in self.ship_static_data:
                        raw_ship_type = self.ship_static_data[mmsi].get('ship_type')
                        cached_draught = self.ship_static_data[mmsi].get('draught')
                        logger.debug(f"✅ Found cached ship type for {ship_name}: Type={raw_ship_type}, Draught={cached_draught}")
                    
                    if not raw_ship_type:
                        raw_ship_type = meta_data.get('ShipType')
                    
                    # Normalize ship type and category
                    ship_type, ship_category = self._normalize_ship_type(raw_ship_type)
                    
                    # Check if it's a container ship by name (major container lines)
                    ship_name_upper = ship_name.upper()
                    if any(line in ship_name_upper for line in ['MSC', 'MAERSK', 'CMA CGM', 'COSCO', 'EVERGREEN', 'HAPAG', 'ONE ', 'YANG MING', 'YM ', 'HMM ']):
                        ship_category = 'Container'
                        logger.debug(f"   → Detected container ship by name: {ship_name}")
                    
                    # Get destination, convert "N/A" or empty to None
                    destination = meta_data.get('Destination')
                    if destination in ['N/A', 'n/a', '', None]:
                        destination = None
                    
                    # Infer ballast from draught if available (heuristic)
                    # Try cached draught first, then metadata
                    draught = cached_draught if cached_draught else self._parse_draught(meta_data.get('Draught'))
                    is_ballast = draught is not None and draught <= 4.0
                    
                    if draught:
                        logger.debug(f"   → Draught: {draught}m, Ballast: {is_ballast}")

                    # Create vessel object
                    vessel = {
                        'type': 'vessel_update',
                        'data': {
                            'mmsi': meta_data.get('MMSI'),
                            'name': meta_data.get('ShipName', f"Vessel {meta_data.get('MMSI')}"),
                            'latitude': ais_data.get('Latitude'),
                            'longitude': ais_data.get('Longitude'),
                            'speed': ais_data.get('Sog', 0),
                            'course': ais_data.get('Cog', 0),  # Course Over Ground
                            'heading': ais_data.get('TrueHeading', 0),  # True Heading (may be 0 if not available)
                            'ship_type': ship_type,
                            'destination': destination,
                            'status': ais_data.get('NavigationalStatus', 'Underway'),
                            'timestamp': meta_data.get('time_utc'),
                            'is_ballast': is_ballast,
                            'is_anchored': ais_data.get('NavigationalStatus') == 1,
                            'is_stationary': ais_data.get('Sog', 0) < 0.5,
                            'ship_category': ship_category,
                            'draught': draught
                        }
                    }
                    
                                        # Forward to all connected clients
                    disconnected_clients = set()
                    for client in self.clients:
                        try:
                            await client.send_json(vessel)
                        except Exception as e:
                            logger.warning(f"Client disconnected: {e}")
                            disconnected_clients.add(client)
                    
                    # Remove disconnected clients
                    self.clients -= disconnected_clients

                    # Broadcast to external callback (e.g. WebSocketManager)
                    if self.message_callback:
                        try:
                            # Send only the data part because WebSocketManager wraps it
                            if asyncio.iscoroutinefunction(self.message_callback):
                                await self.message_callback(vessel['data'])
                            else:
                                self.message_callback(vessel['data'])
                        except Exception as e:
                            logger.error(f"Error in message callback: {e}")

                    
        except websockets.exceptions.ConnectionClosed:
            logger.warning("🔌 AISStream connection closed")
        except Exception as e:
            logger.error(f"❌ Error forwarding AIS data: {e}")
    
    async def start(self):
        """Start the proxy service"""
        if self.is_running:
            logger.warning("Proxy already running")
            return
            
        self.is_running = True
        
        while self.is_running:
            try:
                if await self.connect_to_aisstream():
                    await self.forward_ais_data()
                    
                # Reconnect after 5 seconds if connection lost
                if self.is_running:
                    logger.info("🔄 Reconnecting in 5 seconds...")
                    await asyncio.sleep(5)
                    
            except Exception as e:
                logger.error(f"❌ Proxy error: {e}")
                await asyncio.sleep(5)
    
    async def stop(self):
        """Stop the proxy service"""
        self.is_running = False
        if self.ais_websocket:
            await self.ais_websocket.close()
        logger.info("🛑 AIS Proxy stopped")
    
    async def add_client(self, websocket: WebSocket):
        """Add a frontend client"""
        self.clients.add(websocket)
        logger.info(f"📱 Client connected. Total clients: {len(self.clients)}")
    
    async def remove_client(self, websocket: WebSocket):
        """Remove a frontend client"""
        self.clients.discard(websocket)
        logger.info(f"📱 Client disconnected. Total clients: {len(self.clients)}")

# Global proxy instance
ais_proxy = None

def get_ais_proxy(api_key: str) -> AISWebSocketProxy:
    """Get or create AIS proxy instance"""
    global ais_proxy
    if ais_proxy is None:
        ais_proxy = AISWebSocketProxy(api_key)
    return ais_proxy
