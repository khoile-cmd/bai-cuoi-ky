(function (global) {
  "use strict";

  let csrfToken = null;

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.method && options.method !== "GET") {
      if (!csrfToken) {
        const csrfResponse = await fetch("/api/auth/csrf", {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          cache: "no-store"
        });
        const csrfData = await csrfResponse.json();
        if (!csrfResponse.ok || typeof csrfData.csrfToken !== "string") {
          throw new Error(csrfData.error || "Không thể xác thực biểu mẫu. Hãy tải lại trang.");
        }
        csrfToken = csrfData.csrfToken;
      }
      headers.set("X-CSRF-Token", csrfToken);
    }

    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 403) csrfToken = null;
      throw Object.assign(new Error(data.error || "Yêu cầu không thành công. Vui lòng thử lại."), {
        status: response.status
      });
    }
    if (data.csrfToken) csrfToken = data.csrfToken;
    return data;
  }

  global.EchoTaleAuth = Object.freeze({
    async currentUser() {
      try {
        const result = await request("/api/auth/me");
        return result.user;
      } catch (error) {
        if (error.status === 401 || error.message === "Bạn chưa đăng nhập.") return null;
        throw error;
      }
    },
    async register(details) {
      const result = await request("/api/auth/register", {
        method: "POST",
        body: details
      });
      csrfToken = null;
      return result.user;
    },
    async login(details) {
      const result = await request("/api/auth/login", {
        method: "POST",
        body: details
      });
      csrfToken = null;
      return result.user;
    },
    async logout() {
      await request("/api/auth/logout", { method: "POST", body: {} });
      csrfToken = null;
    }
  });
})(window);
