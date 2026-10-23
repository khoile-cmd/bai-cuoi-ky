import hmac
import os
import re
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import timedelta, timezone, datetime
from pathlib import Path

import bcrypt
from dotenv import load_dotenv
from flask import Flask, current_app, jsonify, request, send_from_directory, session
from werkzeug.exceptions import BadRequest

ROOT = Path(__file__).resolve().parent
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
AUTH_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash BLOB NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL,
    action TEXT NOT NULL,
    attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_ip_action_time
    ON auth_attempts (ip_address, action, attempted_at);
"""
FRONTEND_FILES = {"styler.css", "data-service.js", "auth-client.js", "data-models.json"}
DUMMY_PASSWORD_HASH = bcrypt.hashpw(b"invalid-account-password", bcrypt.gensalt(rounds=12))


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_db():
    connection = sqlite3.connect(current_app.config["DATABASE_PATH"], timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def database_connection():
    connection = get_db()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def init_db():
    database_path = Path(current_app.config["DATABASE_PATH"])
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with database_connection() as connection:
        connection.executescript(AUTH_SCHEMA)


def public_user(row):
    return {
        "id": row["id"],
        "username": row["username"],
        "email": row["email"],
        "createdAt": row["created_at"],
    }


def json_error(message, status):
    return jsonify({"error": message}), status


def request_data():
    if not request.is_json:
        return None
    try:
        payload = request.get_json()
    except BadRequest:
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def verify_csrf():
    expected = session.get("csrf_token")
    supplied = request.headers.get("X-CSRF-Token", "")
    if not expected or not supplied or not hmac.compare_digest(expected, supplied):
        return json_error("Phiên biểu mẫu không hợp lệ. Hãy tải lại trang và thử lại.", 403)
    return None


def apply_rate_limit(action, limit, window_seconds):
    now = int(datetime.now(timezone.utc).timestamp())
    ip_address = request.remote_addr or "unknown"
    with database_connection() as connection:
        connection.execute("DELETE FROM auth_attempts WHERE attempted_at < ?", (now - 86400,))
        attempts = connection.execute(
            "SELECT COUNT(*) FROM auth_attempts WHERE ip_address = ? AND action = ? AND attempted_at >= ?",
            (ip_address, action, now - window_seconds),
        ).fetchone()[0]
        if attempts >= limit:
            return json_error("Bạn đã thử quá nhiều lần. Vui lòng đợi rồi thử lại.", 429)
        connection.execute(
            "INSERT INTO auth_attempts (ip_address, action, attempted_at) VALUES (?, ?, ?)",
            (ip_address, action, now),
        )
    return None


def create_app(test_config=None):
    load_dotenv(ROOT / ".env")
    app = Flask(__name__, static_folder=None)
    secret_key = os.environ.get("APP_SECRET_KEY")
    if not test_config and (
        not secret_key
        or len(secret_key) < 32
        or secret_key.startswith("replace-with-")
    ):
        raise RuntimeError("Set APP_SECRET_KEY to a unique secret of at least 32 characters in .env.")
    app.config.update(
        SECRET_KEY=secret_key or "test-only-secret",
        DATABASE_PATH=os.environ.get("DATABASE_PATH", str(ROOT / "instance" / "echo-tale.sqlite3")),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "").lower() == "true",
        PERMANENT_SESSION_LIFETIME=timedelta(days=7),
        SESSION_REFRESH_EACH_REQUEST=False,
        MAX_CONTENT_LENGTH=16 * 1024,
    )
    if test_config:
        app.config.update(test_config)

    with app.app_context():
        init_db()

    @app.get("/")
    @app.get("/index.html")
    def index():
        return send_from_directory(ROOT, "index.html")

    @app.get("/<path:filename>")
    def frontend_file(filename):
        if filename not in FRONTEND_FILES:
            return json_error("Không tìm thấy tài nguyên.", 404)
        return send_from_directory(ROOT, filename)

    @app.get("/api/auth/csrf")
    def csrf_token():
        session.setdefault("csrf_token", secrets.token_urlsafe(32))
        return jsonify({"csrfToken": session["csrf_token"]})

    @app.get("/api/auth/me")
    def current_user():
        user_id = session.get("user_id")
        if not isinstance(user_id, int):
            return json_error("Bạn chưa đăng nhập.", 401)
        with database_connection() as connection:
            user = connection.execute(
                "SELECT id, username, email, created_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        if user is None:
            session.clear()
            return json_error("Phiên đăng nhập không còn hợp lệ.", 401)
        return jsonify({"user": public_user(user)})

    @app.post("/api/auth/register")
    def register():
        csrf_error = verify_csrf()
        if csrf_error:
            return csrf_error
        rate_error = apply_rate_limit("register", 5, 3600)
        if rate_error:
            return rate_error
        payload = request_data()
        if payload is None:
            return json_error("Dữ liệu gửi lên không hợp lệ.", 400)

        username = payload.get("username")
        email = payload.get("email")
        password = payload.get("password")
        if not all(isinstance(value, str) for value in (username, email, password)):
            return json_error("Vui lòng nhập tên, email và mật khẩu.", 400)

        username = username.strip()
        email = email.strip().lower()
        if not username or len(username) > 60:
            return json_error("Tên hiển thị phải có từ 1 đến 60 ký tự.", 400)
        if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
            return json_error("Email không đúng định dạng.", 400)
        if len(password) < 3:
            return json_error("Mật khẩu cần có ít nhất 3 ký tự.", 400)
        try:
            password_bytes = password.encode("utf-8")
        except UnicodeEncodeError:
            return json_error("Mật khẩu chứa ký tự không hợp lệ.", 400)
        if len(password_bytes) > 72:
            return json_error("Mật khẩu không được vượt quá 72 byte UTF-8.", 400)

        password_hash = bcrypt.hashpw(password_bytes, bcrypt.gensalt(rounds=12))
        try:
            with database_connection() as connection:
                cursor = connection.execute(
                    "INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
                    (username, email, password_hash, utc_now()),
                )
                user = connection.execute(
                    "SELECT id, username, email, created_at FROM users WHERE id = ?",
                    (cursor.lastrowid,),
                ).fetchone()
        except sqlite3.IntegrityError:
            return json_error("Email này đã được đăng ký.", 409)

        session.clear()
        session.permanent = True
        session["user_id"] = user["id"]
        session["csrf_token"] = secrets.token_urlsafe(32)
        return jsonify({"user": public_user(user)}), 201

    @app.post("/api/auth/login")
    def login():
        csrf_error = verify_csrf()
        if csrf_error:
            return csrf_error
        rate_error = apply_rate_limit("login", 10, 900)
        if rate_error:
            return rate_error
        payload = request_data()
        if payload is None:
            return json_error("Dữ liệu gửi lên không hợp lệ.", 400)
        email = payload.get("email")
        password = payload.get("password")
        if not isinstance(email, str) or not isinstance(password, str):
            return json_error("Vui lòng nhập email và mật khẩu.", 400)
        try:
            password_bytes = password.encode("utf-8")
        except UnicodeEncodeError:
            return json_error("Email hoặc mật khẩu không chính xác.", 401)
        if len(password_bytes) > 72:
            return json_error("Email hoặc mật khẩu không chính xác.", 401)
        email = email.strip().lower()
        if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
            return json_error("Email hoặc mật khẩu không chính xác.", 401)

        with database_connection() as connection:
            user = connection.execute(
                "SELECT id, username, email, password_hash, created_at FROM users WHERE email = ?",
                (email,),
            ).fetchone()
        password_hash = user["password_hash"] if user else DUMMY_PASSWORD_HASH
        password_matches = bcrypt.checkpw(password_bytes, password_hash)
        if not user or not password_matches:
            return json_error("Email hoặc mật khẩu không chính xác.", 401)

        session.clear()
        session.permanent = True
        session["user_id"] = user["id"]
        session["csrf_token"] = secrets.token_urlsafe(32)
        return jsonify({"user": public_user(user)})

    @app.post("/api/auth/logout")
    def logout():
        csrf_error = verify_csrf()
        if csrf_error:
            return csrf_error
        session.clear()
        return jsonify({"message": "Đã đăng xuất."})

    @app.after_request
    def security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("Cache-Control", "no-store")
        return response

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
        debug=os.environ.get("FLASK_DEBUG", "").lower() == "true",
    )
