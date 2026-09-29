(function () {
  const TOKEN_KEY = 'mawww_token';
  const USER_KEY  = 'mawww_user';

  const store = {
    getToken: () => localStorage.getItem(TOKEN_KEY),
    setToken: (t) => localStorage.setItem(TOKEN_KEY, t),
    clear: () => {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
    getUser: () => {
      try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
      catch { return null; }
    },
    setUser: (u) => localStorage.setItem(USER_KEY, JSON.stringify(u))
  };

  async function request(path, options = {}) {
    const { skipAuth = false, body, headers: extraHeaders, ...rest } = options;
    const headers = { ...(extraHeaders || {}) };

    if (body !== undefined && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    if (!skipAuth) {
      const token = store.getToken();
      if (token) headers['Authorization'] = 'Bearer ' + token;
    }

    let res;
    try {
      res = await fetch(path, {
        ...rest,
        headers,
        body: body instanceof FormData
          ? body
          : (body !== undefined ? JSON.stringify(body) : undefined)
      });
    } catch {
      throw new Error('Tidak dapat terhubung ke server');
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { message: text }; }
    }

    if (!res.ok) {
      if (res.status === 401) {
        store.clear();
        const here = location.pathname;
        if (here !== '/' && here !== '/login' && !here.endsWith('login.html')) {
          location.replace('/login');
        }
      }
      const msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  window.api = request;
  window.authStore = store;
})();
