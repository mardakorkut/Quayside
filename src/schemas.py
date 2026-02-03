from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime

# User Schemas
class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: int
    email: str
    username: str
    created_at: datetime
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

# Vessel Schemas
class VesselCreate(BaseModel):
    mmsi: str
    name: Optional[str] = None
    imo: Optional[str] = None
    callsign: Optional[str] = None
    ship_type: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class VesselResponse(BaseModel):
    id: int
    mmsi: str
    name: Optional[str] = None
    imo: Optional[str] = None
    callsign: Optional[str] = None
    ship_type: Optional[str] = None
    latitude: float = 0.0  # Default 0.0 if not in DB
    longitude: float = 0.0  # Default 0.0 if not in DB
    added_at: datetime
    
    class Config:
        from_attributes = True

# Note Schemas
class NoteCreate(BaseModel):
    vessel_id: int
    content: str

class NoteResponse(BaseModel):
    id: int
    vessel_id: int
    content: str
    created_at: datetime
    
    class Config:
        from_attributes = True
