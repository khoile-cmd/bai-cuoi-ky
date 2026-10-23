# ECHO-TALE authentication

The current frontend uses browser-local registration and sign-in. Accounts and the signed-in user ID are stored in `localStorage`, so registration signs in immediately and remains signed in on that browser. Passwords are not stored in plain text: `auth-client.js` derives a salted PBKDF2-SHA-256 hash in the browser. This mode works for a prototype only; browser storage can be read or changed by scripts running on the page, accounts do not sync between devices, and client-side authentication is not a security boundary. Do not use it for production accounts or sensitive content. Use the Flask/SQLite backend below for a production-oriented deployment instead.

On page load, the app checks its local session before enabling member actions. Signed-out visitors can browse story introductions and chapter titles. Opening chapter text, listening, favorites, bookmarks, comments, ratings, and collection actions prompt them to sign in or register; the interrupted action resumes after successful authentication. The account dialog cannot be dismissed with its close button, backdrop, or Escape.

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

## Optional Flask authentication backend

`app.py` still provides a Flask/SQLite authentication API, but the current browser client does not call these routes. If you switch the UI back to server-backed auth, configure the client and server together; do not treat browser-local authentication as authorization for backend data.

The available same-origin JSON endpoints are:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/csrf` | Issue a CSRF token for the current session |
| `POST` | `/api/auth/register` | Create an account and sign in |
| `POST` | `/api/auth/login` | Verify email/password and sign in |
| `GET` | `/api/auth/me` | Return the current account |
| `POST` | `/api/auth/logout` | End the current session |

Mutating requests require the `X-CSRF-Token` header. Registration validates the display name, email, and a password of at least 3 characters (without composition rules). bcrypt accepts at most 72 UTF-8 bytes per password. Login errors do not disclose whether an email is registered. Repeated registration and login attempts are rate-limited by client IP.

## Run the tests

```powershell
python -m unittest discover -s tests -v
```

## Before production deployment

- Set a unique, randomly generated `APP_SECRET_KEY` through the hosting provider's secret manager.
- Set `COOKIE_SECURE=true` when serving the site over HTTPS.
- Keep `FLASK_DEBUG=false`, use a production WSGI server, and configure HTTPS at the hosting layer.
- Back up the SQLite database and restrict access to the `instance` directory. For multi-instance hosting, use a shared database instead of a local SQLite file and configure the same strong signing secret on every instance. If you switch to server-side sessions, use a shared session store.

Profile name and avatar remain per-browser preferences. In the current local-auth mode, account details and password hashes are also browser-local; the optional Flask backend stores account identity and bcrypt password hashes in SQLite.
