(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const origins = new Set([
    'https://www.facebook.com',
    'https://web.facebook.com',
    'https://facebook.com',
  ]);
  let token = null;
  let config = null;
  let generation = 0;
  let attempt = null;
  let sdkPromise = null;
  byId('domain').textContent = `Website domain: ${location.hostname}`;

  function status(text, error = false) {
    byId('status').textContent = text;
    byId('status').dataset.error = String(error);
  }
  function clearAttempt() {
    if (attempt) clearTimeout(attempt.timer);
    attempt = null;
    byId('connect').disabled = !token || !config || !window.FB;
    byId('language').disabled = false;
    byId('refresh').disabled = !token;
  }
  function signOut() {
    generation += 1;
    token = null;
    config = null;
    clearAttempt();
    byId('password').value = '';
    byId('setup').hidden = true;
    byId('signin').hidden = false;
    byId('store').textContent = '';
    byId('connection').textContent = '';
    status('Signed out. Sign in again to continue.');
  }
  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(45000),
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(
        'The server returned an unreadable response. Refresh status before retrying.',
      );
    }
    if (!response.ok) {
      if (response.status === 401 && token) {
        signOut();
        status('Your Zomaal session expired. Sign in again to continue.', true);
      }
      const message = Array.isArray(body.message)
        ? body.message.join('; ')
        : body.message;
      throw new Error(message || `Request failed (HTTP ${response.status}).`);
    }
    if (
      response.headers.get('x-zomaal-mock-data') === 'true' ||
      body.mock === true
    ) {
      throw new Error(
        'This server is using preview data. Real connection testing is unavailable.',
      );
    }
    return body;
  }
  function renderConnection(body) {
    const connection = body.connection;
    byId('connection').textContent = body.connected
      ? `Connected: ${connection.displayPhoneNumber || 'WhatsApp Business number'} (${connection.status}).`
      : connection
        ? `Connection status: ${connection.status}. Reconnect with Meta to continue.`
        : 'No WhatsApp number connected to this store.';
    byId('connect').textContent = body.connected
      ? 'Reconnect WhatsApp'
      : 'Connect WhatsApp';
  }
  async function refresh() {
    const session = generation;
    const result = await api('/whatsapp/connection');
    if (session !== generation || !token) return;
    renderConnection(result);
    return result;
  }
  function loadSdk() {
    if (window.FB) return Promise.resolve();
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        script.remove();
        sdkPromise = null;
        reject(
          new Error(
            'Meta sign-in did not load. Check your connection or browser blocking settings, then sign in again.',
          ),
        );
      }, 20000);
      window.fbAsyncInit = () => {
        clearTimeout(timer);
        resolve();
      };
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.async = true;
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        sdkPromise = null;
        reject(
          new Error(
            'Could not load Meta sign-in. Check browser blocking settings and sign in again.',
          ),
        );
      };
      document.head.appendChild(script);
    });
    return sdkPromise;
  }
  byId('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const session = ++generation;
    byId('login').disabled = true;
    status('Signing in…');
    try {
      const body = JSON.stringify({
        phone: byId('phone').value.trim(),
        password: byId('password').value,
      });
      byId('password').value = '';
      const auth = await api('/auth/login', { method: 'POST', body });
      if (session !== generation) return;
      if (!auth.accessToken)
        throw new Error('Sign-in did not return an access token.');
      token = auth.accessToken;
      const [settings, store] = await Promise.all([
        api('/whatsapp/config'),
        api('/stores/me'),
      ]);
      if (session !== generation) return;
      if (
        !settings.enabled ||
        !/^\d+$/.test(settings.appId) ||
        !/^\d+$/.test(settings.configId) ||
        !/^v\d+\.\d+$/.test(settings.graphApiVersion)
      )
        throw new Error(
          'Real WhatsApp signup is not configured on this server.',
        );
      config = settings;
      byId('store').textContent =
        `Active store: ${store.businessName || 'Your store'}. Use the Zomaal app to change the active store before continuing.`;
      byId('signin').hidden = true;
      byId('setup').hidden = false;
      await refresh();
      status('Loading Meta sign-in…');
      await loadSdk();
      if (session !== generation) return;
      window.FB.init({
        appId: config.appId,
        version: config.graphApiVersion,
        autoLogAppEvents: false,
        xfbml: false,
      });
      byId('connect').disabled = false;
      status('Ready. Select Connect WhatsApp to approve access with Meta.');
    } catch (error) {
      if (session === generation) {
        signOut();
        status(error.message, true);
      }
    } finally {
      byId('login').disabled = false;
    }
  });
  byId('logout').addEventListener('click', signOut);
  byId('refresh').addEventListener('click', async () => {
    byId('refresh').disabled = true;
    try {
      await refresh();
      if (token) status('Connection status refreshed.');
    } catch (error) {
      status(error.message, true);
    } finally {
      byId('refresh').disabled = !token;
    }
  });
  async function finish(current) {
    if (attempt !== current || current.sending || !current.code || !current.ids)
      return;
    current.sending = true;
    clearTimeout(current.timer);
    status('Saving your WhatsApp connection and submitting templates…');
    try {
      const body = JSON.stringify({
        code: current.code,
        ...current.ids,
        language: current.language,
      });
      current.code = null;
      current.ids = null;
      const result = await api('/whatsapp/connect', { method: 'POST', body });
      if (attempt !== current || current.generation !== generation) return;
      renderConnection(result);
      status(
        result.connected
          ? 'WhatsApp connected. Check template approval, pricing and balance before enabling messages.'
          : 'Meta returned a connection requiring attention. Refresh status before trying again.',
        !result.connected,
      );
    } catch (error) {
      if (attempt === current && current.generation === generation)
        status(
          `${error.message} Refresh status before starting a new signup.`,
          true,
        );
    } finally {
      if (attempt === current) clearAttempt();
    }
  }
  window.addEventListener('message', (event) => {
    const current = attempt;
    if (!current || current.sending || !origins.has(event.origin)) return;
    let data = event.data;
    try {
      if (typeof data === 'string') data = JSON.parse(data);
    } catch {
      return;
    }
    if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;
    if (data.event === 'CANCEL' || data.event === 'ERROR') {
      clearAttempt();
      status(
        'Meta signup was cancelled or could not finish. You can start again.',
        true,
      );
      return;
    }
    if (
      data.event !== 'FINISH' &&
      data.event !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
    )
      return;
    const wabaId = data.data?.waba_id,
      phoneNumberId = data.data?.phone_number_id;
    if (
      typeof wabaId !== 'string' ||
      typeof phoneNumberId !== 'string' ||
      !/^\d{5,30}$/.test(wabaId) ||
      !/^\d{5,30}$/.test(phoneNumberId)
    ) {
      clearAttempt();
      status(
        'Meta did not return both account and phone-number IDs. Check the Embedded Signup configuration and try again.',
        true,
      );
      return;
    }
    current.ids = { wabaId, phoneNumberId };
    void finish(current);
  });
  byId('connect').addEventListener('click', () => {
    if (!token || !config || !window.FB || attempt) return;
    const current = {
      generation,
      code: null,
      ids: null,
      sending: false,
      language: byId('language').value,
    };
    attempt = current;
    byId('connect').disabled = true;
    byId('language').disabled = true;
    byId('refresh').disabled = true;
    status(
      'Complete the Meta popup to select your WhatsApp Business account and number.',
    );
    current.timer = setTimeout(() => {
      if (attempt === current) {
        clearAttempt();
        status(
          'Signup timed out. Start again to get a fresh authorization.',
          true,
        );
      }
    }, 600000);
    try {
      window.FB.login(
        (response) => {
          if (attempt !== current || current.sending) return;
          const code = response?.authResponse?.code;
          if (typeof code !== 'string' || !code || code.length > 2048) {
            clearAttempt();
            status(
              'Meta did not provide a signup authorization code. Check the popup or start again.',
              true,
            );
            return;
          }
          current.code = code;
          status(
            'Meta authorized access. Waiting for the selected account and number…',
          );
          void finish(current);
        },
        {
          config_id: config.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { sessionInfoVersion: '3' },
        },
      );
    } catch {
      clearAttempt();
      status(
        'Meta could not open signup. Allow popups and check the Meta app’s allowed website domains.',
        true,
      );
    }
  });
  window.addEventListener('pagehide', signOut);
})();
