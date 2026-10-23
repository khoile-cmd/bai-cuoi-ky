(function (global) {
  "use strict";

  const usersKey = "echotale-local-users-v1";
  const sessionKey = "echotale-local-session-v1";
  const passwordIterations = 310000;
  const encoder = new TextEncoder();

  function readStoredJson(key, fallback) {
    const value = global.localStorage.getItem(key);
    if (value === null) return fallback;
    try {
      return JSON.parse(value);
    } catch (error) {
      console.error(`Không thể đọc dữ liệu xác thực "${key}".`, error);
      throw new Error("Dữ liệu tài khoản trên trình duyệt bị lỗi. Hãy xóa dữ liệu trang và thử lại.");
    }
  }

  function writeStoredJson(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Không thể lưu dữ liệu xác thực "${key}".`, error);
      throw new Error("Không thể lưu tài khoản trên trình duyệt. Hãy kiểm tra dung lượng và quyền lưu trữ.");
    }
  }

  function getUsers() {
    const users = readStoredJson(usersKey, []);
    if (!Array.isArray(users) || users.some((user) => !user || typeof user !== "object"
      || typeof user.id !== "string" || typeof user.username !== "string"
      || typeof user.email !== "string")) {
      throw new Error("Dữ liệu tài khoản trên trình duyệt không hợp lệ.");
    }
    return users;
  }

  function getCrypto() {
    if (!global.crypto?.subtle || !global.crypto.getRandomValues) {
      throw new Error("Trình duyệt không hỗ trợ lưu mật khẩu an toàn. Hãy mở trang bằng HTTPS hoặc localhost.");
    }
    return global.crypto;
  }

  function toBase64(bytes) {
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return global.btoa(binary);
  }

  function fromBase64(value) {
    const binary = global.atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function hashPassword(password, salt) {
    const crypto = getCrypto();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits({
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: passwordIterations
    }, key, 256);
    return new Uint8Array(bits);
  }

  function sameBytes(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
      difference |= left[index] ^ right[index];
    }
    return difference === 0;
  }

  function publicUser(user) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.createdAt
    };
  }

  function saveSession(user) {
    writeStoredJson(sessionKey, { userId: user.id });
    return publicUser(user);
  }

  global.EchoTaleAuth = Object.freeze({
    async currentUser() {
      const session = readStoredJson(sessionKey, null);
      if (session === null) return null;
      if (!session || typeof session.userId !== "string") {
        throw new Error("Phiên đăng nhập trên trình duyệt không hợp lệ.");
      }
      const user = getUsers().find((item) => item.id === session.userId);
      if (!user) {
        global.localStorage.removeItem(sessionKey);
        return null;
      }
      return publicUser(user);
    },

    async register(details) {
      const username = typeof details?.username === "string" ? details.username.trim() : "";
      const email = typeof details?.email === "string" ? details.email.trim().toLowerCase() : "";
      const password = typeof details?.password === "string" ? details.password : "";
      if (!username || username.length > 60) {
        throw new Error("Tên hiển thị phải có từ 1 đến 60 ký tự.");
      }
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        throw new Error("Email không đúng định dạng.");
      }
      if (password.length < 3) {
        throw new Error("Mật khẩu cần có ít nhất 3 ký tự.");
      }
      const passwordBytes = encoder.encode(password);
      if (passwordBytes.length > 72) {
        throw new Error("Mật khẩu không được vượt quá 72 byte UTF-8.");
      }

      const users = getUsers();
      if (users.some((user) => user.email.toLowerCase() === email)) {
        throw new Error("Email này đã được đăng ký trên trình duyệt.");
      }

      const crypto = getCrypto();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const user = {
        id: typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : toBase64(crypto.getRandomValues(new Uint8Array(16))),
        username,
        email,
        passwordSalt: toBase64(salt),
        passwordHash: toBase64(await hashPassword(password, salt)),
        createdAt: new Date().toISOString()
      };
      writeStoredJson(usersKey, [...users, user]);
      return saveSession(user);
    },

    async login(details) {
      const email = typeof details?.email === "string" ? details.email.trim().toLowerCase() : "";
      const password = typeof details?.password === "string" ? details.password : "";
      const user = getUsers().find((item) => item.email.toLowerCase() === email);
      if (!user || typeof user.passwordSalt !== "string" || typeof user.passwordHash !== "string") {
        throw new Error("Email hoặc mật khẩu không chính xác.");
      }

      let matches = false;
      try {
        matches = sameBytes(
          await hashPassword(password, fromBase64(user.passwordSalt)),
          fromBase64(user.passwordHash)
        );
      } catch (error) {
        console.error("Không thể xác minh mật khẩu cục bộ.", error);
        throw new Error("Không thể xác minh tài khoản trên trình duyệt.");
      }
      if (!matches) throw new Error("Email hoặc mật khẩu không chính xác.");
      return saveSession(user);
    },

    async logout() {
      global.localStorage.removeItem(sessionKey);
    }
  });
})(window);
