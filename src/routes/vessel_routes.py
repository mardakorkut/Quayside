"""
FastAPI Vessel Routes
API endpoints for vessel data with user authentication
"""
from fastapi import APIRouter, Query, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import logging
from sqlalchemy.orm import Session

from src.services.ais_service import AISStreamService
from src.database import get_db, User, Vessel, Note
from src.auth import get_current_user
from src.schemas import VesselCreate, VesselResponse, NoteCreate, NoteResponse

logger = logging.getLogger(__name__)

router = APIRouter()


# ==================== DATA MODELS ====================

class VesselResponse(BaseModel):
    """Vessel data response model"""
    mmsi: str
    name: str
    latitude: float
    longitude: float
    speed: float = 0
    heading: int = 0
    callsign: Optional[str] = None
    ship_type: Optional[str] = None
    draught: Optional[float] = None
    destination: Optional[str] = None
    status: Optional[str] = None
    timestamp: Optional[str] = None


# ==================== ENDPOINTS ====================

# IMPORTANT: Specific routes must come before generic routes with path parameters
# So /vessels/my-vessels must come before /vessels/{mmsi}

@router.get("/vessels/my-vessels", response_model=List[VesselResponse])
async def get_my_vessels(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all vessels tracked by current user"""
    
    logger.info(f"📥 get_my_vessels called for user: {current_user.email if current_user else 'None'}")
    
    if not current_user:
        logger.error("❌ current_user is None!")
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    vessels = db.query(Vessel).filter(Vessel.user_id == current_user.id).all()
    logger.info(f"✅ Found {len(vessels)} vessels for {current_user.email}")
    
    # Add dummy coordinates for response model if not in DB
    # In a real app, you might want to fetch latest live coordinates here
    response_list = []
    for v in vessels:
        v_dict = {c.name: getattr(v, c.name) for c in v.__table__.columns}
        v_dict['latitude'] = 0.0  # Default or fetch live
        v_dict['longitude'] = 0.0 # Default or fetch live
        response_list.append(VesselResponse.model_validate(v_dict))
        
    return response_list


@router.get("/vessels/bbox")
async def get_vessels_bbox(
    min_lat: float = Query(..., ge=-90, le=90),
    min_lon: float = Query(..., ge=-180, le=180),
    max_lat: float = Query(..., ge=-90, le=90),
    max_lon: float = Query(..., ge=-180, le=180),
):
    """
    Get vessels within a bounding box
    
    Query params:
    - min_lat: Minimum latitude (-90 to 90)
    - min_lon: Minimum longitude (-180 to 180)
    - max_lat: Maximum latitude
    - max_lon: Maximum longitude
    
    Example: /api/vessels/bbox?min_lat=40&min_lon=27&max_lat=42&max_lon=30
    """
    try:
        # Validate bbox
        if min_lat > max_lat or min_lon > max_lon:
            raise HTTPException(
                status_code=400,
                detail="Invalid bounding box: min values must be less than max values"
            )
        
        service = AISStreamService()
        vessels = service.get_vessels_by_bbox(min_lat, min_lon, max_lat, max_lon)
        
        return vessels
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error fetching vessels: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/vessels/{mmsi}", response_model=VesselResponse)
async def get_vessel(mmsi: str):
    """
    Get specific vessel by MMSI (Maritime Mobile Service Identity)
    
    Args:
        mmsi: 9-digit MMSI number
    
    Example: /api/vessels/636019821
    """
    try:
        if not mmsi.isdigit() or len(mmsi) != 9:
            raise HTTPException(
                status_code=400,
                detail="Invalid MMSI format. Must be 9 digits"
            )
        
        service = AISStreamService()
        vessel = service.get_vessel_by_mmsi(mmsi)
        
        if not vessel:
            raise HTTPException(status_code=404, detail=f"Vessel {mmsi} not found")
        
        # Parse vessel data to match response model
        parsed = service.parse_vessel_data(vessel)
        return parsed
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching vessel {mmsi}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/vessels/search")
async def search_vessels(
    query: Optional[str] = Query(None, min_length=2, description="Search by name, callsign, or MMSI"),
    name: Optional[str] = Query(None, min_length=2),
    callsign: Optional[str] = Query(None, min_length=2),
):
    """
    Search for vessels by name, callsign, or MMSI
    
    Query params:
    - query: General search term (searches name, callsign, MMSI)
    - name: Ship name (partial match)
    - callsign: Call sign (partial match)
    
    Example: /api/vessels/search?query=MSC
    """
    try:
        if not query and not name and not callsign:
            raise HTTPException(
                status_code=400,
                detail="Provide query, name, or callsign parameter"
            )
        
        service = AISStreamService()
        results = []
        
        # Use query parameter for general search
        search_term = (query or name or callsign).upper().strip()
        
        # No mock data - vessels should be added from live AIS stream only
        # Frontend will search in already loaded vessels (allVessels Map)
        results = []
        
        return results
    
    except Exception as e:
        logger.error(f"Error searching vessels: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/stats")
async def get_vessel_stats():
    """Get vessel tracking statistics"""
    try:
        # TODO: Implement statistics gathering
        return {
            "total_vessels_tracked": 0,
            "active_connections": 0,
            "last_update": None
        }
    except Exception as e:
        logger.error(f"Error fetching stats: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ==================== USER VESSEL MANAGEMENT ====================

@router.post("/vessels/track", response_model=VesselResponse)
async def track_vessel(
    vessel_data: VesselCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a vessel to user's tracked vessels"""
    
    logger.info(f"📥 track_vessel called: MMSI={vessel_data.mmsi}, user={current_user.email if current_user else 'None'}")
    
    # Check if already tracking this vessel
    existing = db.query(Vessel).filter(
        Vessel.user_id == current_user.id,
        Vessel.mmsi == vessel_data.mmsi
    ).first()
    
    if existing:
        logger.warning(f"⚠️ Vessel {vessel_data.mmsi} already tracked by {current_user.email}")
        raise HTTPException(
            status_code=400,
            detail="Already tracking this vessel"
        )
    
    # Create new tracked vessel
    new_vessel = Vessel(
        user_id=current_user.id,
        mmsi=vessel_data.mmsi,
        name=vessel_data.name,
        imo=vessel_data.imo,
        callsign=vessel_data.callsign,
        ship_type=vessel_data.ship_type
    )

    db.add(new_vessel)
    db.commit()
    db.refresh(new_vessel)
    
    logger.info(f"✅ Vessel {vessel_data.mmsi} added for user {current_user.email}, ID={new_vessel.id}")
    logger.info(f"✅ User {current_user.email} tracking vessel {vessel_data.mmsi}")
    
    # Convert SQLAlchemy object to dict for Pydantic
    vessel_dict = {c.name: getattr(new_vessel, c.name) for c in new_vessel.__table__.columns}
    
    # Add coordinates from request for response model compatibility
    vessel_dict['latitude'] = vessel_data.latitude
    vessel_dict['longitude'] = vessel_data.longitude
    
    return VesselResponse.model_validate(vessel_dict)




@router.delete("/vessels/track/{vessel_id}")
async def untrack_vessel(
    vessel_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove a vessel from user's tracked vessels"""
    
    vessel = db.query(Vessel).filter(
        Vessel.id == vessel_id,
        Vessel.user_id == current_user.id
    ).first()
    
    if not vessel:
        raise HTTPException(status_code=404, detail="Vessel not found")
    
    db.delete(vessel)
    db.commit()
    
    logger.info(f"✅ User {current_user.email} untracked vessel {vessel.mmsi}")
    
    return {"message": "Vessel removed from tracking"}


@router.delete("/vessels/track/mmsi/{mmsi}")
async def untrack_vessel_by_mmsi(
    mmsi: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove a vessel from user's tracked vessels by MMSI"""

    vessel = db.query(Vessel).filter(
        Vessel.mmsi == mmsi,
        Vessel.user_id == current_user.id
    ).first()

    if not vessel:
        raise HTTPException(status_code=404, detail="Vessel not found")

    db.delete(vessel)
    db.commit()

    logger.info(f"✅ User {current_user.email} untracked vessel {vessel.mmsi} by MMSI")

    return {"message": "Vessel removed from tracking"}


@router.post("/vessels/{vessel_id}/notes", response_model=NoteResponse)
async def add_vessel_note(
    vessel_id: int,
    note_data: NoteCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a note to a tracked vessel"""
    
    # Verify vessel belongs to user
    vessel = db.query(Vessel).filter(
        Vessel.id == vessel_id,
        Vessel.user_id == current_user.id
    ).first()
    
    if not vessel:
        raise HTTPException(status_code=404, detail="Vessel not found")
    
    # Create note
    new_note = Note(
        vessel_id=vessel_id,
        user_id=current_user.id,
        content=note_data.content
    )
    
    db.add(new_note)
    db.commit()
    db.refresh(new_note)
    
    logger.info(f"✅ User {current_user.email} added note to vessel {vessel.mmsi}")
    
    return NoteResponse.model_validate(new_note)


@router.get("/vessels/{vessel_id}/notes", response_model=List[NoteResponse])
async def get_vessel_notes(
    vessel_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all notes for a tracked vessel"""
    
    # Verify vessel belongs to user
    vessel = db.query(Vessel).filter(
        Vessel.id == vessel_id,
        Vessel.user_id == current_user.id
    ).first()
    
    if not vessel:
        raise HTTPException(status_code=404, detail="Vessel not found")
    
    notes = db.query(Note).filter(Note.vessel_id == vessel_id).all()
    return [NoteResponse.model_validate(n) for n in notes]


@router.delete("/vessels/{vessel_id}/notes/{note_id}")
async def delete_vessel_note(
    vessel_id: int,
    note_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a note from a tracked vessel"""
    
    note = db.query(Note).filter(
        Note.id == note_id,
        Note.vessel_id == vessel_id,
        Note.user_id == current_user.id
    ).first()
    
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    db.delete(note)
    db.commit()
    
    logger.info(f"✅ User {current_user.email} deleted note {note_id}")
    
    return {"message": "Note deleted"}
