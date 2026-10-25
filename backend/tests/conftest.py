import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(scope="session")
def client(tmp_path_factory):
    os.environ["PATCHWORK_DB"] = str(tmp_path_factory.mktemp("db") / "test.db")
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
