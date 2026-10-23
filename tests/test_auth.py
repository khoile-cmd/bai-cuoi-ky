import sqlite3
import tempfile
import unittest
from pathlib import Path

from app import create_app


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "auth.sqlite3"
        self.app = create_app({
            "TESTING": True,
            "SECRET_KEY": "test-secret-key",
            "DATABASE_PATH": str(self.database_path),
            "SESSION_COOKIE_SECURE": False,
        })
        self.client = self.app.test_client()
        self.csrf_token = self.client.get("/api/auth/csrf").get_json()["csrfToken"]

    def tearDown(self):
        self.temporary_directory.cleanup()

    def post_auth(self, route, payload):
        return self.client.post(
            route,
            json=payload,
            headers={"X-CSRF-Token": self.csrf_token},
        )

    def test_register_logs_user_in_and_does_not_return_password_hash(self):
        response = self.post_auth("/api/auth/register", {
            "username": "Lan Nguyễn",
            "email": "lan@example.com",
            "password": "correct-horse-17",
        })

        self.assertEqual(response.status_code, 201)
        self.assertNotIn("password", response.get_json()["user"])
        self.assertEqual(self.client.get("/api/auth/me").get_json()["user"]["email"], "lan@example.com")
        with sqlite3.connect(self.database_path) as connection:
            password_hash = connection.execute(
                "SELECT password_hash FROM users WHERE email = ?",
                ("lan@example.com",),
            ).fetchone()[0]
        self.assertTrue(password_hash.startswith(b"$2"))

    def test_duplicate_email_is_rejected_case_insensitively(self):
        self.post_auth("/api/auth/register", {
            "username": "Lan",
            "email": "lan@example.com",
            "password": "correct-horse-17",
        })
        response = self.post_auth("/api/auth/register", {
            "username": "Other",
            "email": "LAN@example.com",
            "password": "correct-horse-18",
        })

        self.assertEqual(response.status_code, 409)

    def test_password_validation_and_login_errors(self):
        short_password = self.post_auth("/api/auth/register", {
            "username": "Lan",
            "email": "lan@example.com",
            "password": "short",
        })
        self.assertEqual(short_password.status_code, 400)

        self.post_auth("/api/auth/register", {
            "username": "Lan",
            "email": "lan@example.com",
            "password": "correct-horse-17",
        })
        self.csrf_token = self.client.get("/api/auth/csrf").get_json()["csrfToken"]
        self.client.post("/api/auth/logout", headers={"X-CSRF-Token": self.csrf_token})
        self.csrf_token = self.client.get("/api/auth/csrf").get_json()["csrfToken"]
        incorrect_login = self.post_auth("/api/auth/login", {
            "email": "lan@example.com",
            "password": "not-the-password",
        })
        self.assertEqual(incorrect_login.status_code, 401)

        correct_login = self.post_auth("/api/auth/login", {
            "email": "LAN@example.com",
            "password": "correct-horse-17",
        })
        self.assertEqual(correct_login.status_code, 200)
        self.assertEqual(correct_login.get_json()["user"]["username"], "Lan")
        self.csrf_token = self.client.get("/api/auth/csrf").get_json()["csrfToken"]
        self.assertEqual(
            self.client.post("/api/auth/logout", headers={"X-CSRF-Token": self.csrf_token}).status_code,
            200,
        )
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)

    def test_auth_mutations_require_csrf(self):
        response = self.client.post("/api/auth/register", json={
            "username": "Lan",
            "email": "lan@example.com",
            "password": "correct-horse-17",
        })
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
