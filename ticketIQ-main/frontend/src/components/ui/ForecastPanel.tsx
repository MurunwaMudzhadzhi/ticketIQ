"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";

interface ForecastPoint {
  date: string;
  predicted_ticket_volume: number;
  confidence_level: "low" | "medium" | "high";
}

interface ForecastData {
  generated_at: string;
  model: string;
  mae: number | null;
  rmse: number | null;
  days_of_data: number;
  forecast_days: number;
  data: ForecastPoint[];
}

interface InsightsData {
  insights: string;
  mae: number | null;
  days_of_data: number;
  forecast_days: number;
}

type Horizon = 7 | 14 | 30;

function confidenceColor(level: string): string {
  if (level === "high")   return "#10B981";
  if (level === "medium") return "#F59E0B";
  return "#EF4444";
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
}

function getToken(): string | null {
  try {
    return localStorage.getItem("access_token");
  } catch {
    return null;
  }
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
      Loading forecast…
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-48 text-red-400 text-sm">
      {message}
    </div>
  );
}

export default function ForecastPanel() {
  const [horizon,  setHorizon]  = useState<Horizon>(7);
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const headers = { Authorization: `Bearer ${token}` };

    async function fetchAll() {
      try {
        const [fRes, iRes] = await Promise.all([
          fetch(`${API}/analytics/forecast?days=${horizon}`,          { headers }),
          fetch(`${API}/analytics/forecast/insights?days=${horizon}`, { headers }),
        ]);

        if (!fRes.ok) throw new Error(`Forecast API ${fRes.status}`);
        if (!iRes.ok) throw new Error(`Insights API ${iRes.status}`);

        const [fData, iData] = await Promise.all([fRes.json(), iRes.json()]);
        setForecast(fData);
        setInsights(iData);
      } catch (err: any) {
        setError(err?.message ?? "Failed to fetch");
      } finally {
        setLoading(false);
      }
    }

    fetchAll();
  }, [API, horizon]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-6">

      {/* Header + horizon toggle */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Ticket Volume Forecast
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Predicted daily ticket volume — next {horizon} days
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Horizon selector */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            {([7, 14, 30] as Horizon[]).map((d) => (
              <button
                key={d}
                onClick={() => setHorizon(d)}
                className={`px-3 py-1.5 transition-colors ${
                  horizon === d
                    ? "bg-blue-500 text-white"
                    : "bg-white text-gray-500 hover:bg-gray-50"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          {/* Meta badges */}
          {forecast && (
            <div className="flex gap-2 text-xs text-gray-400">
              {forecast.mae !== null && (
                <span className="bg-gray-50 border border-gray-100 rounded-lg px-2 py-1">
                  MAE ±{forecast.mae}
                </span>
              )}
              <span className="bg-gray-50 border border-gray-100 rounded-lg px-2 py-1">
                {forecast.days_of_data}d history
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : forecast ? (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={forecast.data}
              margin={{ top: 4, right: 4, left: -16, bottom: 0 }}
              barSize={horizon === 30 ? 12 : horizon === 14 ? 20 : 32}
            >
              <XAxis
                dataKey="date"
                tickFormatter={formatDateLabel}
                tick={{ fontSize: 10, fill: "#9CA3AF" }}
                tickLine={false}
                axisLine={false}
                interval={horizon === 30 ? 4 : horizon === 14 ? 1 : 0}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#9CA3AF" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "#F9FAFB" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as ForecastPoint;
                  return (
                    <div className="bg-white border border-gray-100 rounded-xl shadow-sm px-3 py-2 text-xs">
                      <p className="font-medium text-gray-800">
                        {new Date(d.date).toLocaleDateString("en-ZA", {
                          weekday: "long", day: "numeric", month: "short",
                        })}
                      </p>
                      <p className="text-gray-600 mt-0.5">
                        {d.predicted_ticket_volume} tickets predicted
                      </p>
                      <p style={{ color: confidenceColor(d.confidence_level) }}>
                        {d.confidence_level} confidence
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="predicted_ticket_volume" radius={[4, 4, 0, 0]}>
                {forecast.data.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fill={confidenceColor(entry.confidence_level)}
                    fillOpacity={0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div className="flex gap-4 text-xs text-gray-400">
            {(["high", "medium", "low"] as const).map((level) => (
              <span key={level} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: confidenceColor(level) }}
                />
                {level} confidence
              </span>
            ))}
          </div>
        </>
      ) : null}

      {/* Management summary */}
      {insights && (
        <div className="border-t border-gray-50 pt-5">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
            Management summary · {horizon}-day outlook
          </p>
          <div className="space-y-3">
            {insights.insights.split("\n\n").map((para, i) => (
              <p key={i} className="text-sm text-gray-600 leading-relaxed">
                {para}
              </p>
            ))}
          </div>
          {forecast && (
            <p className="text-xs text-gray-300 mt-4">
              Generated {new Date(forecast.generated_at).toLocaleString("en-ZA")}
              {" · "}Model: {forecast.model}
            </p>
          )}
        </div>
      )}
    </div>
  );
}