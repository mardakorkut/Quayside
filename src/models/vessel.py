"""
Vessel Data Model
"""
from datetime import datetime
from pydantic import BaseModel
from typing import Optional


class VesselLocation(BaseModel):
    """Vessel Location Data"""
    latitude: float
    longitude: float
    speed: float = 0  # Knots
    heading: int = 0  # Degrees


class VesselInfo(BaseModel):
    """Vessel Information"""
    mmsi: str
    name: str
    callsign: Optional[str] = None
    ship_type: Optional[str] = None
    draught: Optional[float] = None
    destination: Optional[str] = None
    status: Optional[str] = None


class Vessel(BaseModel):
    """Complete Vessel Data"""
    mmsi: str
    name: str
    callsign: Optional[str] = None
    latitude: float
    longitude: float
    speed: float = 0
    heading: int = 0
    ship_type: Optional[str] = None
    draught: Optional[float] = None
    destination: Optional[str] = None
    status: Optional[str] = None
    timestamp: datetime
    
    # Filtreleme etiketleri
    is_ballast: bool = False  # Boş/yük bekliyor
    is_anchored: bool = False  # Demirde
    is_stationary: bool = False  # Durgun
    ship_category: Optional[str] = None  # Tanker, Container, Cargo, Other
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
