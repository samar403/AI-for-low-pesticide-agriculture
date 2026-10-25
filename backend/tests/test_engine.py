import numpy as np

from app.detector import detect, evaluate_field, get_model
from app.geo import connected_components, dilate, polygon_mask
from app.prescription import PRODUCTS, PrescriptionParams, build_prescription, plan_mission, prescription_geojson
from app.simulator import FIELDS, simulate_survey
from app.vision_rgb import analyze_image, sample_image


def test_simulator_is_deterministic():
    a = simulate_survey("north-40", 40)
    b = simulate_survey.__wrapped__("north-40", 40)
    assert np.allclose(a.ndvi, b.ndvi)
    assert (a.truth == b.truth).all()


def test_threats_grow_through_season():
    early = simulate_survey("mesa-block", 10).truth
    late = simulate_survey("mesa-block", 60).truth
    assert (late > 0).sum() > (early > 0).sum()


def test_geometry_helpers():
    m = polygon_mask(10, 10, [(0, 0), (10, 0), (0, 10)])
    assert m[0, 0] and not m[9, 9]
    labels, n = connected_components(np.array([[1, 0, 1], [1, 0, 0], [0, 0, 1]], dtype=bool))
    assert n == 3
    d = dilate(np.pad(np.ones((1, 1), bool), 2), 1)
    assert d.sum() == 9


def test_model_quality_on_held_out_fields():
    m = get_model().metrics
    assert m["accuracy"] > 0.88
    assert m["pest"]["recall"] > 0.8
    assert m["disease"]["recall"] > 0.8
    assert m["false_spray_rate"] < 0.08


def test_live_fields_detect_threats():
    for f in FIELDS:
        e = evaluate_field(f.id, 55)
        assert e["accuracy"] > 0.88, f.id


def test_prescription_respects_label_rate_and_buffers():
    det = detect("north-40", 55)
    rx = build_prescription(det)
    s = simulate_survey("north-40", 55)
    for key, rate in rx.rates.items():
        assert rate.max() <= PRODUCTS[key].label_rate_l_ha + 1e-9
        assert (rate[s.no_spray] == 0).all(), "no-spray buffer violated"
        assert (rate[~s.cropped] == 0).all()
    assert 0 < rx.summary["volume_l"] < rx.summary["blanket_volume_l"]
    assert rx.summary["chemical_reduction_pct"] > 50


def test_threshold_and_buffer_change_volume():
    det = detect("far-quarter", 55)
    tight = build_prescription(det, PrescriptionParams(threshold=0.8, buffer_cells=0)).summary["volume_l"]
    loose = build_prescription(det, PrescriptionParams(threshold=0.4, buffer_cells=2)).summary["volume_l"]
    assert loose > tight


def test_mission_only_flies_spray_rows():
    rx = build_prescription(detect("creekside", 55))
    m = plan_mission(rx)
    assert m["segments"] > 0
    assert m["total_time_min"] < m["blanket_total_time_min"]
    assert len(m["waypoints"]) == 2 * m["segments"]
    gj = prescription_geojson(rx)
    assert gj["type"] == "FeatureCollection" and gj["features"]


def test_rgb_weed_mapper_finds_rows_and_weeds():
    r = analyze_image(sample_image())
    assert r["rows_detected"] and r["row_orientation"] == "vertical"
    assert 0.002 < r["weed_cover"] < r["crop_cover"]
    assert 0 < r["spray_fraction"] < 0.5
