"""
メインアプリケーションのテスト
"""

from fastapi.testclient import TestClient


def test_root_endpoint(client: TestClient):
    """ルートエンドポイントのテスト"""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert "version" in data
    assert data["message"] == "Welcome to Gestaloka API"


def test_health_check(client: TestClient):
    """ヘルスチェックエンドポイントのテスト"""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data


def test_metrics_endpoint(client: TestClient):
    """メトリクスエンドポイントのテスト"""
    response = client.get("/metrics")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
