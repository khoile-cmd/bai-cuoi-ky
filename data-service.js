(function (global) {
  "use strict";

  const apiConfig = {
    baseUrl: "",
    getAccessToken: null
  };
  let novelDatabasePromise;

  function openNovelDatabase() {
    if (!("indexedDB" in global)) {
      return Promise.reject(new Error("Trình duyệt không hỗ trợ IndexedDB để lưu bộ nhớ đệm truyện."));
    }
    if (!novelDatabasePromise) {
      novelDatabasePromise = new Promise((resolve, reject) => {
        const opening = global.indexedDB.open("echo-tale-content-v1", 1);
        opening.onupgradeneeded = () => {
          const database = opening.result;
          if (!database.objectStoreNames.contains("novels")) {
            database.createObjectStore("novels", { keyPath: "storyId" });
          }
        };
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error || new Error("Không mở được bộ nhớ truyện."));
        opening.onblocked = () => reject(new Error("Bộ nhớ truyện đang bị chặn bởi một tab khác."));
      }).catch((error) => {
        novelDatabasePromise = null;
        throw error;
      });
    }
    return novelDatabasePromise;
  }

  async function getCachedNovel(storyId) {
    const database = await openNovelDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("novels", "readonly");
      const request = transaction.objectStore("novels").get(storyId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Không đọc được truyện đã lưu."));
    });
  }

  async function cacheNovel(storyId, novel) {
    const database = await openNovelDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("novels", "readwrite");
      transaction.objectStore("novels").put({
        ...novel,
        storyId,
        cachedAt: new Date().toISOString()
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Không lưu được truyện vào bộ nhớ đệm."));
      transaction.onabort = () => reject(transaction.error || new Error("Đã hủy lưu truyện vào bộ nhớ đệm."));
    });
  }

  function readLocalJSON(key, fallback) {
    try {
      const raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.error(`Could not read local data "${key}".`, error);
      return fallback;
    }
  }

  function writeLocalJSON(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`Could not save local data "${key}".`, error);
      return false;
    }
  }

  async function request(path, options = {}) {
    if (!apiConfig.baseUrl) {
      throw new Error("API base URL is not configured. Call configureApi({ baseUrl }).");
    }

    const token = apiConfig.getAccessToken ? await apiConfig.getAccessToken() : null;
    const headers = new global.Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await global.fetch(`${apiConfig.baseUrl}${path}`, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`API ${options.method || "GET"} ${path} failed (${response.status}): ${responseText.slice(0, 300)}`);
    }
    if (response.status === 204) return null;

    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : null;
  }

  function configureApi(options) {
    if (!options || typeof options.baseUrl !== "string" || !options.baseUrl.trim()) {
      throw new TypeError("baseUrl must be a valid API URL.");
    }
    apiConfig.baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    apiConfig.getAccessToken = typeof options.getAccessToken === "function"
      ? options.getAccessToken
      : null;
  }

  function createId(prefix) {
    const value = global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}-${value}`;
  }

  // Configure the base URL before calling api methods; the page currently persists through local.
  // These paths define the REST contract expected by the client and its future backend.
  const api = {
    request,
    collections: {
      list: () => request("/api/v1/me/collections"),
      create: (payload) => request("/api/v1/me/collections", { method: "POST", body: payload }),
      update: (collectionId, payload) => request(
        `/api/v1/me/collections/${encodeURIComponent(collectionId)}`,
        { method: "PATCH", body: payload }
      ),
      remove: (collectionId) => request(
        `/api/v1/me/collections/${encodeURIComponent(collectionId)}`,
        { method: "DELETE" }
      ),
      addItem: (collectionId, item) => request(
        `/api/v1/me/collections/${encodeURIComponent(collectionId)}/items`,
        { method: "POST", body: item }
      ),
      removeItem: (collectionId, itemId) => request(
        `/api/v1/me/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`,
        { method: "DELETE" }
      )
    },
    bookmarks: {
      list: () => request("/api/v1/me/bookmarks"),
      save: (bookmark) => request("/api/v1/me/bookmarks", { method: "PUT", body: bookmark }),
      remove: (storyId) => request(`/api/v1/me/bookmarks/${encodeURIComponent(storyId)}`, { method: "DELETE" })
    },
    comments: {
      list: (storyId) => request(`/api/v1/stories/${encodeURIComponent(storyId)}/comments`),
      create: (comment) => request("/api/v1/me/comments", { method: "POST", body: comment }),
      remove: (commentId) => request(`/api/v1/me/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" })
    },
    ratings: {
      save: (rating) => request("/api/v1/me/ratings", { method: "POST", body: rating }),
      list: (storyId) => request(`/api/v1/stories/${encodeURIComponent(storyId)}/ratings`)
    },
    preferences: {
      get: () => request("/api/v1/me/preferences"),
      save: (preferences) => request("/api/v1/me/preferences", { method: "PUT", body: preferences })
    }
  };

  global.EchoTaleDataService = Object.freeze({
    local: Object.freeze({ readJSON: readLocalJSON, writeJSON: writeLocalJSON }),
    content: Object.freeze({ getCachedNovel, cacheNovel }),
    api,
    configureApi,
    models: Object.freeze({
      createCollection(name) {
        const now = new Date().toISOString();
        return {
          id: createId("collection"),
          name: name.trim(),
          items: [],
          createdAt: now,
          updatedAt: now
        };
      },
      createCollectionItem(item) {
        return {
          id: createId("saved-item"),
          storyId: item.storyId,
          chapterIndex: Number.isInteger(item.chapterIndex) ? item.chapterIndex : null,
          chapterTitle: item.chapterTitle || "Introduction",
          paragraphIndex: Number.isInteger(item.paragraphIndex) ? item.paragraphIndex : 0,
          addedAt: new Date().toISOString()
        };
      }
    })
  });
})(window);
