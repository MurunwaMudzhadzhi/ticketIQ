"""
TicketIQ — Forecast Endpoint (Sprint 3)
=========================================
Exposes the 7-day ticket volume forecast produced by
services/ml/forecast_service.py over HTTP.

Endpoints:
  GET /analytics/forecast          — JSON forecast (dashboard widget)
  GET /analytics/forecast/insights — Plain-English management summary

Both endpoints require a logged-in user. The forecast itself is
available to any role (agents and admins need it for planning); the
insights summary is also open to all authenticated users because it
contains no sensitive raw data — only aggregated trend language.
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
 
from sqlalchemy.ext.asyncio import AsyncSession
 
from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.models import User
from app.services.ml.forecast_service import get_forecast
from app.services.ml.insight_generator import generate_forecast_insights
 
router = APIRouter(prefix="/analytics", tags=["forecast"])
 
 
class ForecastPoint(BaseModel):
    date: str
    predicted_ticket_volume: int
    confidence_level: str
 
 
class ForecastResponse(BaseModel):
    generated_at: str
    model: str
    mae: Optional[float]
    rmse: Optional[float]
    days_of_data: int
    forecast_days: int
    data: List[ForecastPoint]
 
 
@router.get("/forecast", response_model=ForecastResponse)
async def forecast(
    days: int = Query(default=7, ge=7, le=30, description="Forecast horizon: 7, 14, or 30"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns a ticket volume forecast.
    Use ?days=7, ?days=14, or ?days=30 to control the horizon.
    """
    # Snap to valid options
    if days <= 7:
        days = 7
    elif days <= 14:
        days = 14
    else:
        days = 30
 
    result = await get_forecast(db, forecast_days=days)
    return result
 
 
@router.get("/forecast/insights")
async def forecast_insights(
    days: int = Query(default=7, ge=7, le=30),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns a plain-English management summary for the given forecast horizon."""
    if days <= 7:
        days = 7
    elif days <= 14:
        days = 14
    else:
        days = 30
 
    forecast_data = await get_forecast(db, forecast_days=days)
    insights_text = await generate_forecast_insights(forecast_data)
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "forecast_model": forecast_data["model"],
        "mae": forecast_data["mae"],
        "days_of_data": forecast_data["days_of_data"],
        "forecast_days": days,
        "insights": insights_text,
    }