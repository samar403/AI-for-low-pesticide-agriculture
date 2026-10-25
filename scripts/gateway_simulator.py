#!/usr/bin/env python3
"""Pretend to be a LoRaWAN/cellular field gateway and stream readings to the Patchwork API.

Usage:
    python scripts/gateway_simulator.py                      # one batch for every station
    python scripts/gateway_simulator.py --loop 10            # a batch every 10 s
    python scripts/gateway_simulator.py --moth-flight north-40-trap-5

Uses only the standard library, so it runs on a Raspberry Pi gateway as-is.
"""
from __future__ import annotations

import argparse
import json
import random
import time
import urllib.request
from datetime import datetime, timezone

FIELDS = ("north-40", "creekside", "mesa-block", "far-quarter")


def stations(api: str) -> list[dict]:
    out = []
    for f in FIELDS:
        with urllib.request.urlopen(f"{api}/api/fields/{f}") as r:
            out.extend(json.load(r)["stations"])
    return out


def reading(st: dict, moth_flight: str | None) -> list[dict]:
    ts = datetime.now(timezone.utc).isoformat()
    k = st["kind"]
    if k == "trap":
        lam = 40 if st["id"] == moth_flight else 4
        return [{"station_id": st["id"], "metric": "trap_count", "value": random.randint(int(lam * 0.7), int(lam * 1.3)), "ts": ts}]
    if k == "weather":
        return [
            {"station_id": st["id"], "metric": "air_temp_c", "value": round(random.uniform(16, 30), 1), "ts": ts},
            {"station_id": st["id"], "metric": "humidity_pct", "value": round(random.uniform(40, 95), 1), "ts": ts},
            {"station_id": st["id"], "metric": "leaf_wetness", "value": round(random.random(), 2), "ts": ts},
        ]
    return [
        {"station_id": st["id"], "metric": "soil_moisture_pct", "value": round(random.uniform(18, 35), 1), "ts": ts},
        {"station_id": st["id"], "metric": "soil_temp_c", "value": round(random.uniform(15, 24), 1), "ts": ts},
    ]


def push(api: str, rows: list[dict]) -> dict:
    req = urllib.request.Request(f"{api}/api/telemetry", data=json.dumps({"readings": rows}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--loop", type=float, default=0, help="seconds between batches (0 = send once)")
    ap.add_argument("--moth-flight", help="station id of a trap that should report a moth flight")
    a = ap.parse_args()
    sts = stations(a.api)
    while True:
        rows = [r for st in sts for r in reading(st, a.moth_flight)]
        res = push(a.api, rows)
        print(f"{datetime.now():%H:%M:%S} sent {len(rows)} readings: {res['accepted']} accepted, {len(res['rejected'])} rejected")
        if not a.loop:
            break
        time.sleep(a.loop)


if __name__ == "__main__":
    main()
