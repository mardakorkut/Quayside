"""
AIS (Automatic Identification System) Data Service
Handles real-time vessel data from AISStream.io
"""
import logging
import os
from typing import Dict, List, Optional

import requests

logger = logging.getLogger(__name__)


class AISStreamService:
    """Service for fetching vessel data from AISStream.io"""

    BASE_URL = "https://api.aisstream.io/v0/stream"

    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv("AISSTREAM_API_KEY")
        if not self.api_key:
            raise ValueError("AISSTREAM_API_KEY not configured")

    def get_vessels_by_bbox(
        self,
        min_lat: float,
        min_lon: float,
        max_lat: float,
        max_lon: float,
    ) -> List[Dict]:
        """Fetch vessels within a bounding box."""
        try:
            params = {
                "apiKey": self.api_key,
                "minLat": min_lat,
                "minLon": min_lon,
                "maxLat": max_lat,
                "maxLon": max_lon,
            }

            response = requests.get(self.BASE_URL, params=params, timeout=10)
            response.raise_for_status()

            raw_vessels = response.json()
            parsed_vessels = []
            for raw_vessel in (raw_vessels if isinstance(raw_vessels, list) else []):
                try:
                    parsed = self.parse_vessel_data(raw_vessel)
                    if parsed.get("mmsi"):
                        parsed_vessels.append(parsed)
                except Exception as e:
                    logger.warning(f"Error parsing vessel data: {e}")
                    continue

            logger.info(f"Found {len(parsed_vessels)} vessels in bbox")
            return parsed_vessels
        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching vessels from AISStream: {e}")
            logger.warning("AISStream request failed; returning empty list")
            return []

    def get_vessel_by_mmsi(self, mmsi: str) -> Optional[Dict]:
        """Fetch specific vessel by MMSI."""
        try:
            params = {
                "apiKey": self.api_key,
                "mmsi": mmsi,
            }

            response = requests.get(self.BASE_URL, params=params, timeout=10)
            response.raise_for_status()

            data = response.json()
            return data[0] if data else None
        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching vessel {mmsi}: {e}")
            logger.info(f"Vessel {mmsi} not found in API")
            return None

    def parse_vessel_data(self, raw_data: Dict) -> Dict:
        """Parse and format raw AIS data."""
        speed = raw_data.get("SOG", 0) or 0
        destination = (raw_data.get("Destination") or "").upper()
        status = (raw_data.get("Status") or "").upper()
        nav_status = raw_data.get("NavigationStatus", 0)
        ship_type = raw_data.get("ShipType") or ""

        is_ballast = any(keyword in destination for keyword in ["FOR ORDERS", "WAITING", "AWAITING", "BALLAST"])
        is_anchored = (nav_status == 1) or ("ANCHOR" in status)
        is_stationary = speed < 0.5
        ship_category = self._categorize_ship(ship_type)

        return {
            "mmsi": str(raw_data.get("MMSI") or ""),
            "name": raw_data.get("ShipName") or "Unknown",
            "callsign": raw_data.get("CallSign") or "",
            "latitude": float(raw_data.get("Latitude") or 0),
            "longitude": float(raw_data.get("Longitude") or 0),
            "speed": float(speed or 0),
            "heading": int(raw_data.get("COG") or 0),
            "ship_type": ship_type,
            "draught": raw_data.get("Draught") or raw_data.get("DRAUGHT"),
            "destination": raw_data.get("Destination") or "--",
            "status": raw_data.get("Status") or "--",
            "timestamp": raw_data.get("TimeStamp") or raw_data.get("Timestamp"),
            "is_ballast": is_ballast,
            "is_anchored": is_anchored,
            "is_stationary": is_stationary,
            "ship_category": ship_category,
        }

    def _categorize_ship(self, ship_type: str) -> str:
        ship_type_lower = (ship_type or "").lower()
        if "tanker" in ship_type_lower or "oil" in ship_type_lower or "lng" in ship_type_lower or "lpg" in ship_type_lower:
            return "Tanker"
        if "container" in ship_type_lower:
            return "Container"
        if "cargo" in ship_type_lower or "bulk" in ship_type_lower or "general" in ship_type_lower:
            return "Cargo"
        return "Other"
