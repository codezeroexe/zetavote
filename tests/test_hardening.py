from fastapi.testclient import TestClient

from backend.app import app


client = TestClient(app)


def test_security_headers_present():
    response = client.get('/health')
    assert response.status_code == 200
    assert response.headers.get('x-content-type-options') == 'nosniff'
    assert response.headers.get('x-frame-options') == 'DENY'
    assert response.headers.get('referrer-policy') == 'no-referrer'
