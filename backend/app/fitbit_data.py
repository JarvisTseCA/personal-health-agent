"""
Turns Google Health API data points into the plain rows the app reads.

Fitbit data now comes from the Google Health API (the Fitbit Web API was turned
off on Nov 2, 2026). This file only reshapes its JSON: times become the user's
own clock time, durations become minutes. Which app activity a workout is, and
how much it counts, is decided in the frontend (src/lib/fitbit.ts), next to the
rest of the MET-hour math.

An exercise data point looks like:
    {"name": "users/111/dataTypes/exercise/dataPoints/7797",
     "exercise": {"interval": {"startTime": "2026-09-03T11:20:00Z", "startUtcOffset": "-14400s", "endTime": ...},
                  "exerciseType": "RUNNING", "displayName": "Run", "activeDuration": "1740s",
                  "metricsSummary": {"averageHeartRateBeatsPerMinute": "142",
                                     "heartRateZoneDurations": {"moderateTime": "600s", "vigorousTime": "900s"}}}}
Field names: https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints
"""
import re
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

ZONES = ("light", "moderate", "vigorous", "peak")


def seconds(duration: Optional[str]) -> float:
    """A duration string such as "1740s" or "-14400s" in seconds; 0 when missing."""
    if not duration:
        return 0.0
    if not duration.endswith("s"):
        raise ValueError(f"Not a duration: {duration!r}")
    return float(duration[:-1])


def _utc(timestamp: str) -> datetime:
    # Older Pythons only parse 3 or 6 fractional digits and no trailing Z; seconds are enough here.
    return datetime.fromisoformat(re.sub(r"\.\d+", "", timestamp).replace("Z", "+00:00"))


def local_time(timestamp: str, utc_offset: Optional[str]) -> str:
    """The clock time the user saw, e.g. "2026-09-03T07:20:00", with no zone."""
    t = _utc(timestamp) + timedelta(seconds=seconds(utc_offset))
    return t.replace(tzinfo=None).isoformat(timespec="seconds")


def parse_workout(point: Dict[str, Any]) -> Dict[str, Any]:
    """One exercise data point as a workout row. Minutes exclude pauses when Google reports them."""
    ex = point["exercise"]
    iv = ex["interval"]
    m = ex.get("metricsSummary") or {}
    zones = m.get("heartRateZoneDurations") or {}
    active_s = seconds(ex.get("activeDuration")) or (_utc(iv["endTime"]) - _utc(iv["startTime"])).total_seconds()
    hr = m.get("averageHeartRateBeatsPerMinute")  # a string in the API, e.g. "142"
    return {
        "id": point["name"],
        "exercise_type": ex["exerciseType"],
        "name": ex.get("displayName"),
        "start": local_time(iv["startTime"], iv.get("startUtcOffset")),
        "duration_min": round(active_s / 60),
        "avg_heart_rate": round(float(hr)) if hr else None,
        "zone_min": {z: round(seconds(zones.get(f"{z}Time")) / 60, 1) for z in ZONES},
    }


def parse_vo2(point: Dict[str, Any]) -> Dict[str, Any]:
    """One vo2-max data point as {date, vo2_max, method}, the date on the user's clock."""
    v = point["vo2Max"]
    t = v["sampleTime"]
    return {
        "date": local_time(t["physicalTime"], t.get("utcOffset"))[:10],
        "vo2_max": float(v["vo2Max"]),
        "method": v.get("measurementMethod"),
    }
