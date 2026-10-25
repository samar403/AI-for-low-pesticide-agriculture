def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_farm_and_fields(client):
    farm = client.get("/api/farm").json()
    assert len(farm["fields"]) == 4
    assert farm["totals"]["volume_l"] < farm["totals"]["blanket_volume_l"]
    f = client.get("/api/fields/north-40").json()
    assert f["boundary"]["type"] == "Polygon"
    assert client.get("/api/fields/nope").status_code == 404


def test_layers(client):
    s = client.get("/api/fields/creekside/survey?day=40").json()
    assert len(s["layers"]["ndvi"]) == 34 and len(s["layers"]["ndvi"][0]) == 48
    d = client.get("/api/fields/creekside/detections?day=40").json()
    assert set(d["probabilities"]) == {"weed", "pest", "disease"}
    assert d["hotspots"]
    assert client.get("/api/fields/creekside/survey?day=500").status_code == 422


def test_prescription_lifecycle(client):
    r = client.post("/api/fields/mesa-block/prescriptions", json={"threshold": 0.6, "save": True, "note": "week 8"}).json()
    rid = r["id"]
    assert r["status"] == "draft" and r["mission"]["waypoints"]
    assert client.post(f"/api/prescriptions/{rid}/status", json={"status": "approved"}).json()["status"] == "approved"
    listed = client.get("/api/prescriptions?field_id=mesa-block").json()
    assert listed[0]["id"] == rid and "rates" not in listed[0]
    gj = client.get(f"/api/prescriptions/{rid}/geojson")
    assert gj.status_code == 200 and gj.json()["features"]
    csv = client.get(f"/api/prescriptions/{rid}/csv").text.splitlines()
    assert csv[0].startswith("row,col,lat,lon") and len(csv) > 1
    assert client.post(f"/api/prescriptions/{rid}/status", json={"status": "bogus"}).status_code == 422


def test_telemetry_ingest_drives_fusion(client):
    before = client.get("/api/fields/mesa-block/detections").json()
    trap = next(t for t in before["sensor_context"]["traps"] if t["threshold_ratio"] < 0.5)
    res = client.post(
        "/api/telemetry",
        json={"readings": [
            {"station_id": trap["station_id"], "metric": "trap_count", "value": 60},
            {"station_id": "mesa-block-wx-1", "metric": "soil_moisture_pct", "value": 20},
            {"station_id": "ghost", "metric": "trap_count", "value": 1},
        ]},
    ).json()
    assert res["accepted"] == 1 and len(res["rejected"]) == 2
    after = client.get("/api/fields/mesa-block/detections").json()
    t2 = next(t for t in after["sensor_context"]["traps"] if t["station_id"] == trap["station_id"])
    assert t2["source"] == "live" and t2["threshold_ratio"] > 4
    assert client.get("/api/telemetry?field_id=mesa-block").json()


def test_analytics_and_model(client):
    s = client.get("/api/analytics/season").json()
    assert s["timeline"] and s["cumulative"]["chemical_reduction_pct"] > 50
    m = client.get("/api/model").json()
    assert m["classes"] == ["healthy", "weed", "pest", "disease"]


def test_vision_upload(client):
    png = client.get("/api/vision/sample.png").content
    r = client.post("/api/vision/analyze", files={"file": ("x.png", png, "image/png")}).json()
    assert r["overlay_png"].startswith("data:image/png;base64,")
    bad = client.post("/api/vision/analyze", files={"file": ("x.png", b"not an image", "image/png")})
    assert bad.status_code == 422
