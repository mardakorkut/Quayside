"""
FastAPI Application Configuration
"""
import os
from dotenv import load_dotenv
from typing import List

load_dotenv()


class Settings:
    """Application Settings"""
    
    # Environment
    ENV = os.getenv("ENV", "development")
    DEBUG = ENV == "development"
    
    # API Configuration
    API_TITLE = "Real-time Vessel Tracker API"
    API_VERSION = "1.0.0"
    API_DESCRIPTION = "Professional vessel tracking for maritime brokers"
    
    # Security
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
    JWT_ALGORITHM = "HS256"
    JWT_EXPIRATION_HOURS = 24
    
    # CORS Configuration
    CORS_ORIGINS: List[str] = [
        origin.strip() 
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5000").split(",")
    ]
    CORS_ALLOW_CREDENTIALS = True
    CORS_ALLOW_METHODS = ["*"]
    CORS_ALLOW_HEADERS = ["*"]
    
    # Server Configuration
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", "5000"))
    WORKERS = int(os.getenv("WORKERS", "4"))
    
    # Map Configuration
    DEFAULT_MAP_CENTER_LAT = float(os.getenv("DEFAULT_MAP_CENTER_LAT", "41.0082"))
    DEFAULT_MAP_CENTER_LNG = float(os.getenv("DEFAULT_MAP_CENTER_LNG", "28.9784"))
    DEFAULT_MAP_ZOOM = int(os.getenv("DEFAULT_MAP_ZOOM", "4"))
    
    # AIS Data Configuration
    AISSTREAM_API_KEY = os.getenv("AISSTREAM_API_KEY", "")
    
    # Database Configuration (PostgreSQL)
    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql://user:password@localhost:5432/vessel_tracker"
    )
    SQLALCHEMY_ECHO = DEBUG
    
    # Redis Configuration (Caching & Pub/Sub)
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    # WebSocket Configuration
    WS_HEARTBEAT_INTERVAL = 30  # seconds
    WS_HEARTBEAT_TIMEOUT = 60   # seconds
    
    # Logging Configuration
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    LOG_FILE = "logs/app.log"
    
    # Vessel Data Configuration
    VESSEL_UPDATE_INTERVAL = 5  # seconds
    VESSEL_MAX_AGE = 300  # seconds (5 minutes)
    
    # Rate Limiting
    RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
    RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "100"))
    RATE_LIMIT_PERIOD = int(os.getenv("RATE_LIMIT_PERIOD", "60"))  # seconds


# Create settings instance
settings = Settings()
