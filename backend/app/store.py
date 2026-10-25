"""SQLite persistence for ingested telemetry and saved prescriptions.

Simulated surveys and sensor history are regenerated deterministically, so
only things that originate outside the simulator (live readings pushed to the
ingestion API, and prescriptions an agronomist has saved or approved) are
stored.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    ts TEXT NOT NULL,
    received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS telemetry_station ON telemetry(station_id, metric, ts);
CREATE TABLE IF NOT EXISTS prescriptions (
    id TEXT PRIMARY KEY,
    field_id TEXT NOT NULL,
    day INTEGER NOT NULL,
    status TEXT NOT NULL,
    params TEXT NOT NULL,
    summary TEXT NOT NULL,
    rates TEXT NOT NULL,
    mission TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    approved_at TEXT
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: str | None = None):
        path = path or os.environ.get("PATCHWORK_DB", str(Path(__file__).resolve().parent.parent / "data" / "patchwork.db"))
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(_SCHEMA)

    # ---- telemetry -------------------------------------------------------- #
    def add_readings(self, rows: list[dict]) -> int:
        now = _now()
        with self._lock, self._conn:
            self._conn.executemany(
                "INSERT INTO telemetry (station_id, field_id, metric, value, ts, received_at) VALUES (?,?,?,?,?,?)",
                [(r["station_id"], r["field_id"], r["metric"], r["value"], r["ts"], now) for r in rows],
            )
        return len(rows)

    def recent_readings(self, field_id: str | None = None, limit: int = 100) -> list[dict]:
        q = "SELECT station_id, field_id, metric, value, ts, received_at FROM telemetry"
        args: tuple = ()
        if field_id:
            q += " WHERE field_id = ?"
            args = (field_id,)
        q += " ORDER BY id DESC LIMIT ?"
        with self._lock:
            return [dict(r) for r in self._conn.execute(q, (*args, limit))]

    def latest_trap_means(self, field_id: str, n: int = 3) -> dict[str, float]:
        """Mean of the last ``n`` ingested trap counts per trap station."""
        out: dict[str, float] = {}
        with self._lock:
            stations = [r[0] for r in self._conn.execute("SELECT DISTINCT station_id FROM telemetry WHERE field_id=? AND metric='trap_count'", (field_id,))]
            for sid in stations:
                vals = [r[0] for r in self._conn.execute("SELECT value FROM telemetry WHERE station_id=? AND metric='trap_count' ORDER BY ts DESC, id DESC LIMIT ?", (sid, n))]
                if vals:
                    out[sid] = sum(vals) / len(vals)
        return out

    # ---- prescriptions ---------------------------------------------------- #
    def save_prescription(self, field_id: str, day: int, params: dict, summary: dict, rates: dict, mission: dict, note: str | None) -> dict:
        pid = "rx_" + uuid.uuid4().hex[:10]
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO prescriptions (id, field_id, day, status, params, summary, rates, mission, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (pid, field_id, day, "draft", json.dumps(params), json.dumps(summary), json.dumps(rates), json.dumps(mission), note, _now()),
            )
        return self.get_prescription(pid)

    def _row(self, r: sqlite3.Row, full: bool) -> dict:
        d = dict(r)
        for k in ("params", "summary", "mission"):
            d[k] = json.loads(d[k])
        if full:
            d["rates"] = json.loads(d["rates"])
        else:
            d.pop("rates", None)
            d["mission"] = {k: v for k, v in d["mission"].items() if k != "waypoints"}
        return d

    def get_prescription(self, pid: str, full: bool = True) -> dict | None:
        with self._lock:
            r = self._conn.execute("SELECT * FROM prescriptions WHERE id=?", (pid,)).fetchone()
        return self._row(r, full) if r else None

    def list_prescriptions(self, field_id: str | None = None) -> list[dict]:
        q = "SELECT * FROM prescriptions"
        args: tuple = ()
        if field_id:
            q += " WHERE field_id=?"
            args = (field_id,)
        q += " ORDER BY created_at DESC"
        with self._lock:
            return [self._row(r, False) for r in self._conn.execute(q, args)]

    def set_status(self, pid: str, status: str) -> dict | None:
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE prescriptions SET status=?, approved_at=? WHERE id=?",
                (status, _now() if status == "approved" else None, pid),
            )
        return self.get_prescription(pid, full=False)
