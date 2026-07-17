/**
 * Browser test UI for Web STOMP and Web MQTT local channels.
 */

function log(el, line) {
  const ts = new Date().toISOString().slice(11, 23);
  el.textContent = `[${ts}] ${line}\n` + el.textContent;
}

function setStatus(el, text, ok) {
  el.textContent = text;
  el.className = "status" + (ok === true ? " ok" : ok === false ? " err" : "");
}

function stompFrame(command, headers = {}, body = "") {
  let out = `${command}\n`;
  for (const [k, v] of Object.entries(headers)) out += `${k}:${v}\n`;
  return `${out}\n${body}\0`;
}

function parseStompFrames(buffer) {
  const frames = [];
  let rest = buffer;
  let idx;
  while ((idx = rest.indexOf("\0")) >= 0) {
    frames.push(rest.slice(0, idx + 1));
    rest = rest.slice(idx + 1);
  }
  return { frames, rest };
}

// --- Web STOMP ---
(() => {
  const urlEl = document.getElementById("stomp-url");
  const loginEl = document.getElementById("stomp-login");
  const passcodeEl = document.getElementById("stomp-passcode");
  const subDestEl = document.getElementById("stomp-sub-dest");
  const sendDestEl = document.getElementById("stomp-send-dest");
  const bodyEl = document.getElementById("stomp-body");
  const statusEl = document.getElementById("stomp-status");
  const logEl = document.getElementById("stomp-log");
  const btnConnect = document.getElementById("stomp-connect");
  const btnSub = document.getElementById("stomp-subscribe");
  const btnSend = document.getElementById("stomp-send");
  const btnDisc = document.getElementById("stomp-disconnect");

  let ws = null;
  let buffer = "";
  let subId = "browser-sub-1";

  btnConnect.onclick = () => {
    if (ws) ws.close();
    ws = new WebSocket(urlEl.value);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      setStatus(statusEl, "ws open — sending CONNECT", null);
      ws.send(stompFrame("CONNECT", {
        "accept-version": "1.2",
        host: "localhost",
        ...(loginEl.value ? { login: loginEl.value } : {}),
        ...(passcodeEl.value ? { passcode: passcodeEl.value } : {}),
      }));
      btnSub.disabled = false;
      btnSend.disabled = false;
      btnDisc.disabled = false;
    };
    ws.onmessage = (ev) => {
      buffer += typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data);
      const parsed = parseStompFrames(buffer);
      buffer = parsed.rest;
      for (const raw of parsed.frames) {
        // Agent envelope 通常超过 400 字符；保留足够正文供人工排障和浏览器 E2E 校验。
        log(logEl, `<< ${raw.replace(/\0/g, "\\0").slice(0, 4_000)}`);
        if (raw.startsWith("CONNECTED")) {
          const sessionId = /\nsession:([^\n]+)/.exec(raw)?.[1];
          if (sessionId) subDestEl.value = `/topic/session.stomp:${sessionId}@main`;
          setStatus(statusEl, "STOMP connected", true);
        }
        const ack = raw.match(/\back:([^\n]+)/);
        if (ack?.[1]) ws.send(stompFrame("ACK", { id: ack[1] }));
      }
    };
    ws.onerror = () => setStatus(statusEl, "websocket error", false);
    ws.onclose = () => {
      setStatus(statusEl, "disconnected", false);
      btnSub.disabled = btnSend.disabled = btnDisc.disabled = true;
      ws = null;
    };
  };

  btnSub.onclick = () => {
    if (!ws) return;
    ws.send(
      stompFrame("SUBSCRIBE", {
        id: subId,
        destination: subDestEl.value,
        ack: "client-individual",
      }),
    );
    log(logEl, `>> SUBSCRIBE ${subDestEl.value}`);
  };

  btnSend.onclick = () => {
    if (!ws) return;
    ws.send(
      stompFrame("SEND", { destination: sendDestEl.value, "content-type": "application/json" }, bodyEl.value),
    );
    log(logEl, `>> SEND ${sendDestEl.value}`);
  };

  btnDisc.onclick = () => ws?.close();
})();

// --- Web MQTT ---
(() => {
  const urlEl = document.getElementById("mqtt-url");
  const usernameEl = document.getElementById("mqtt-username");
  const passwordEl = document.getElementById("mqtt-password");
  const subTopicEl = document.getElementById("mqtt-sub-topic");
  const pubTopicEl = document.getElementById("mqtt-pub-topic");
  const bodyEl = document.getElementById("mqtt-body");
  const statusEl = document.getElementById("mqtt-status");
  const logEl = document.getElementById("mqtt-log");
  const btnConnect = document.getElementById("mqtt-connect");
  const btnSub = document.getElementById("mqtt-subscribe");
  const btnPub = document.getElementById("mqtt-publish");
  const btnDisc = document.getElementById("mqtt-disconnect");

  let client = null;

  btnConnect.onclick = () => {
    if (client) client.end(true);
    client = mqtt.connect(urlEl.value, {
      clientId: `browser-${Date.now()}`,
      // 空值保持 undefined，既能测试匿名部署，也能覆盖生产环境常用的账号认证。
      username: usernameEl.value || undefined,
      password: passwordEl.value || undefined,
      reconnectPeriod: 0,
      connectTimeout: 8000,
    });
    client.on("connect", () => {
      setStatus(statusEl, "MQTT connected", true);
      btnSub.disabled = btnPub.disabled = btnDisc.disabled = false;
      log(logEl, "mqtt connect ok");
    });
    client.on("message", (topic, payload) => {
      log(logEl, `<< ${topic}: ${payload.toString()}`);
    });
    client.on("error", (err) => {
      setStatus(statusEl, String(err.message || err), false);
      log(logEl, `error: ${err.message || err}`);
    });
    client.on("close", () => {
      setStatus(statusEl, "disconnected", false);
      btnSub.disabled = btnPub.disabled = btnDisc.disabled = true;
    });
  };

  btnSub.onclick = () => {
    client?.subscribe(subTopicEl.value, (err) => {
      log(logEl, err ? `subscribe err: ${err.message}` : `>> SUB ${subTopicEl.value}`);
    });
  };

  btnPub.onclick = () => {
    client?.publish(pubTopicEl.value, bodyEl.value, {}, (err) => {
      log(logEl, err ? `publish err: ${err.message}` : `>> PUB ${pubTopicEl.value}`);
    });
  };

  btnDisc.onclick = () => client?.end(true);
})();
