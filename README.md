# ECHO-TALE authentication

The existing site is served by a small Flask application. Accounts are stored in SQLite, and passwords are hashed with bcrypt before they are saved. Authentication uses a signed, `HttpOnly` session cookie; the browser does not store passwords or session tokens in local storage.

The former OTP and Google buttons were demo-only and have been replaced with real email/password registration and sign-in. SMS verification, email verification, password reset, and Google OAuth need external providers and are not included.

On page load, the app checks `/api/auth/me` before enabling member actions. Signed-out visitors can browse story introductions and chapter titles. Opening chapter text, listening, favorites, bookmarks, comments, ratings, and collection actions prompt them to sign in or register; the interrupted action resumes after successful authentication. The account dialog cannot be dismissed with its close button, backdrop, or Escape. The server's `HttpOnly` session cookie is authoritative; `localStorage` is not used as proof of authentication.

Guest restrictions in the page are a user-interface gate, not a security boundary. Public Gutenberg source files are fetched by the browser to derive chapter titles, so a determined visitor may inspect those public responses. Content that must be confidential or access-controlled needs to be served through an authenticated backend endpoint rather than a public source URL.

## Requirements

- Python 3.10 or newer
- Windows PowerShell (the commands below use it)

If `py` is not recognized, install Python 3.10 or newer from [python.org](https://www.python.org/downloads/windows/) with the Python Launcher enabled, then reopen PowerShell.

## Install and run locally

1. Open PowerShell in the project folder.
2. Create and activate a virtual environment:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

   If PowerShell blocks activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in that PowerShell window, then activate the environment again.

3. Install the backend libraries:

   ```powershell
   python -m pip install -r requirements.txt
   ```

4. Create the local environment file and generate a secret:

   ```powershell
   Copy-Item .env.example .env
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

   Open `.env` and replace the `APP_SECRET_KEY` example value with the generated value. Keep `.env` private; it is excluded from Git.

5. Start the site and API:

   ```powershell
   python app.py
   ```

6. Visit **http://127.0.0.1:5000**. Do not open `index.html` directly with `file://`; the sign-in forms require the same-origin API and session cookie.

SQLite creates `instance/echo-tale.sqlite3` and its `users` table automatically on first start. No separate database server or manual migration is required.

### Database schema

The `users` table contains:

| Column | SQLite type | Purpose |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY` | Internal account ID |
| `username` | `TEXT NOT NULL` | Display name |
| `email` | `TEXT NOT NULL UNIQUE` | Normalized, lowercase sign-in address |
| `password_hash` | `BLOB NOT NULL` | bcrypt hash (12 rounds), never the raw password |
| `created_at` | `TEXT NOT NULL` | UTC account creation time |

The separate `auth_attempts` table tracks short-lived IP/action timestamps used by the built-in registration and login rate limits.

## Authentication API

All endpoints are same-origin and exchange JSON:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/csrf` | Issue a CSRF token for the current session |
| `POST` | `/api/auth/register` | Create an account and sign in |
| `POST` | `/api/auth/login` | Verify email/password and sign in |
| `GET` | `/api/auth/me` | Return the current account |
| `POST` | `/api/auth/logout` | End the current session |

Mutating requests require the `X-CSRF-Token` header. Registration validates the display name, email, and a password of at least 12 characters. Login errors do not disclose whether an email is registered. Repeated registration and login attempts are rate-limited by client IP.

## Run the tests

```powershell
python -m unittest discover -s tests -v
```

## Before production deployment

- Set a unique, randomly generated `APP_SECRET_KEY` through the hosting provider's secret manager.
- Set `COOKIE_SECURE=true` when serving the site over HTTPS.
- Keep `FLASK_DEBUG=false`, use a production WSGI server, and configure HTTPS at the hosting layer.
- Back up the SQLite database and restrict access to the `instance` directory. For multi-instance hosting, use a shared database instead of a local SQLite file and configure the same strong signing secret on every instance. If you switch to server-side sessions, use a shared session store.

The existing profile name/avatar editor remains a per-browser preference; account identity, email, and password are managed by the server.
