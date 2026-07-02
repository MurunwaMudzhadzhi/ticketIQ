"""
TicketIQ — Forecast Service (Sprint 3)
========================================
Fixed: handles case where all tickets were created within the same week,
causing _engineer_features() to drop all rows (lag_7d needs 7 days history).
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Ticket

# ── Constants ─────────────────────────────────────────────────────────────────

FORECAST_DAYS      = 7
MIN_TRAIN_ROWS     = 7
HOLD_OUT_DAYS      = 14
CONFIDENCE_LOW     = 8.0
CONFIDENCE_MEDIUM  = 4.0

FEATURE_COLS = [
    "day_of_week",
    "week_of_year",
    "month",
    "is_monday",
    "is_weekend",
    "rolling_7d_avg",
    "lag_1d",
    "lag_7d",
]


# ── 1. Load daily counts ───────────────────────────────────────────────────────

async def _load_daily_counts(db: AsyncSession) -> pd.DataFrame:
    result = await db.execute(
        text(
            "SELECT date(created_at) AS day, COUNT(id) AS cnt "
            "FROM tickets "
            "GROUP BY date(created_at) "
            "ORDER BY day ASC"
        )
    )
    rows = result.fetchall()
    if not rows:
        return pd.DataFrame(columns=["date", "ticket_count"])

    df = pd.DataFrame(rows, columns=["date", "ticket_count"])
    df["date"] = pd.to_datetime(df["date"]).dt.date

    # Fill missing dates with 0
    if len(df) > 1:
        full_range = pd.date_range(df["date"].min(), df["date"].max(), freq="D")
        df = (
            df.set_index("date")
              .reindex(full_range.date, fill_value=0)
              .reset_index()
              .rename(columns={"index": "date"})
        )
    return df


# ── 2. Feature engineering ─────────────────────────────────────────────────────

def _engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    dates = pd.to_datetime(df["date"])

    df = df.copy()
    df["day_of_week"]   = dates.dt.dayofweek
    df["week_of_year"]  = dates.dt.isocalendar().week.astype(int)
    df["month"]         = dates.dt.month
    df["is_monday"]     = (dates.dt.dayofweek == 0).astype(int)
    df["is_weekend"]    = (dates.dt.dayofweek >= 5).astype(int)

    df["rolling_7d_avg"] = (
        df["ticket_count"]
          .rolling(window=7, min_periods=1)
          .mean()
          .round(2)
    )
    # FIX: use min_periods=1 on lags so short histories don't wipe all rows
    df["lag_1d"] = df["ticket_count"].shift(1).fillna(0)
    df["lag_7d"] = df["ticket_count"].shift(7).fillna(0)

    df.dropna(inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df


# ── 3. Train model ─────────────────────────────────────────────────────────────

def _train_model(df: pd.DataFrame) -> tuple[LinearRegression, float, float, float]:
    if len(df) < MIN_TRAIN_ROWS:
        model = LinearRegression()
        model.fit(df[FEATURE_COLS], df["ticket_count"])
        return model, float("nan"), float("nan"), float("nan")

    split = max(MIN_TRAIN_ROWS, len(df) - HOLD_OUT_DAYS)
    X_train = df[FEATURE_COLS].iloc[:split]
    y_train = df["ticket_count"].iloc[:split]
    X_test  = df[FEATURE_COLS].iloc[split:]
    y_test  = df["ticket_count"].iloc[split:]

    model = LinearRegression()
    model.fit(X_train, y_train)

    if len(X_test) > 0:
        y_pred = model.predict(X_test)
        mae  = round(float(mean_absolute_error(y_test, y_pred)), 2)
        rmse = round(float(mean_squared_error(y_test, y_pred, squared=False)), 2)
    else:
        mae  = float("nan")
        rmse = float("nan")

    return model, mae, rmse, mae


# ── 4. Build forecast ──────────────────────────────────────────────────────────

def _confidence_label(mae: float) -> str:
    if math.isnan(mae):
        return "low"
    if mae <= CONFIDENCE_MEDIUM:
        return "high"
    if mae <= CONFIDENCE_LOW:
        return "medium"
    return "low"


def _build_forecast(
    model: LinearRegression,
    df: pd.DataFrame,
    confidence_mae: float,
    forecast_days: int = FORECAST_DAYS,
) -> list[dict]:
    history = df["ticket_count"].tolist()
    last_date = df["date"].iloc[-1]
    if isinstance(last_date, str):
        last_date = pd.to_datetime(last_date).date()

    confidence = _confidence_label(confidence_mae)
    forecast = []

    for i in range(1, forecast_days + 1):
        future_date = last_date + timedelta(days=i)
        dt = pd.Timestamp(future_date)

        rolling_avg = round(float(np.mean(history[-7:])), 2)
        lag_1d      = float(history[-1])
        lag_7d      = float(history[-7]) if len(history) >= 7 else rolling_avg

        features = pd.DataFrame([{
            "day_of_week":    dt.dayofweek,
            "week_of_year":   dt.isocalendar()[1],
            "month":          dt.month,
            "is_monday":      int(dt.dayofweek == 0),
            "is_weekend":     int(dt.dayofweek >= 5),
            "rolling_7d_avg": rolling_avg,
            "lag_1d":         lag_1d,
            "lag_7d":         lag_7d,
        }])

        predicted = int(max(0, round(float(model.predict(features[FEATURE_COLS])[0]))))

        forecast.append({
            "date":                    future_date.isoformat(),
            "predicted_ticket_volume": predicted,
            "confidence_level":        confidence,
        })

        history.append(predicted)

    return forecast


# ── 5. Public entry point ──────────────────────────────────────────────────────

async def get_forecast(db: AsyncSession, forecast_days: int = 7) -> dict:
    daily_df = await _load_daily_counts(db)

    # ── Fallback: not enough raw data ─────────────────────────────────────────
    if len(daily_df) < MIN_TRAIN_ROWS:
        last_date = daily_df["date"].iloc[-1] if len(daily_df) else date.today()
        avg = int(round(daily_df["ticket_count"].mean())) if len(daily_df) else 5
        data = [
            {
                "date": (last_date + timedelta(days=i)).isoformat(),
                "predicted_ticket_volume": avg,
                "confidence_level": "low",
            }
            for i in range(1, forecast_days + 1)
        ]
        return {
            "generated_at":  datetime.now(timezone.utc).isoformat(),
            "model":         "rolling_average_fallback",
            "mae":           None,
            "rmse":          None,
            "days_of_data":  len(daily_df),
            "forecast_days": forecast_days,
            "data":          data,
        }

    # ── Main path ─────────────────────────────────────────────────────────────
    featured_df = _engineer_features(daily_df)

    # FIX: after feature engineering, check again — short date ranges
    # (all tickets in same week) still produce too few usable rows.
    if len(featured_df) < MIN_TRAIN_ROWS:
        last_date = daily_df["date"].iloc[-1]
        avg = int(round(daily_df["ticket_count"].mean()))
        data = [
            {
                "date": (last_date + timedelta(days=i)).isoformat(),
                "predicted_ticket_volume": avg,
                "confidence_level": "low",
            }
            for i in range(1, forecast_days + 1)
        ]
        return {
            "generated_at":  datetime.now(timezone.utc).isoformat(),
            "model":         "rolling_average_fallback",
            "mae":           None,
            "rmse":          None,
            "days_of_data":  len(daily_df),
            "forecast_days": forecast_days,
            "data":          data,
        }

    model, mae, rmse, c_mae = _train_model(featured_df)
    forecast_data           = _build_forecast(model, featured_df, c_mae, forecast_days)

    return {
        "generated_at":  datetime.now(timezone.utc).isoformat(),
        "model":         "LinearRegression",
        "mae":           None if math.isnan(mae)  else mae,
        "rmse":          None if math.isnan(rmse) else rmse,
        "days_of_data":  len(daily_df),
        "forecast_days": forecast_days,
        "data":          forecast_data,
    }