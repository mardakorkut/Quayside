"""
User Model for Authentication
"""
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class UserBase(BaseModel):
    """Base user data"""
    email: str
    username: str = Field(..., min_length=3, max_length=50)


class UserCreate(UserBase):
    """User registration data"""
    password: str = Field(..., min_length=6)


class UserLogin(BaseModel):
    """User login credentials"""
    email: str
    password: str


class User(UserBase):
    """Complete user data"""
    id: int
    created_at: datetime
    is_active: bool = True
    
    class Config:
        from_attributes = True


class Token(BaseModel):
    """JWT token response"""
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Token payload data"""
    email: Optional[str] = None
