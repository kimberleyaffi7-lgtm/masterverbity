const $ = (s) => document.querySelector(s);

const state = {
  user: null,
  tab: "login",
  chat: null,
  chats: [],
  providers: [],
  files: [],
  currentRequestController: null,
  uploadController: null,
};

function absoluteUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Upload service returned an empty URL.");
  }

  const raw = value.trim();

  try {
    const url = new URL(raw, window.location.origin);

    // Presigned object-storage URLs must be absolute. Relative URLs
    // are valid for our own API calls, but not for direct object upload.
    if (!/^https?:$/.test(url.protocol)) {
      throw new Error("Upload service returned an unsupported URL.");
    }

    return url.href;
  } catch {
    throw new Error("Upload service returned an invalid upload URL.");
  }
}

async function api(url, opt = {}) {
  const r = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(opt.headers || {}),
    },
    ...opt,
  });

  const j = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(j.error || "Request failed");
  }

  return j;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function showAuth() {
  $("#authView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
}

function showApp() {
  $("#authView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#userLabel").textContent = state.user.email;

  if (state.user.role === "admin") {
    $("#adminBtn").classList.remove("hidden");
  }
}

async function boot() {
  try {
    const j = await api("/api/auth/me");
    state.user = j.user;
    showApp();
    await loadAll();
  } catch {
    showAuth();
  }
}

document.querySelectorAll("[data-tab]").forEach((b) => {
  b.onclick = () => {
    state.tab = b.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach((x) =>
      x.classList.toggle("active", x === b)
    );
    $("#name").classList.toggle("hidden", state.tab === "login");
  };
});

$("#authForm").onsubmit = async (e) => {
  e.preventDefault();
  $("#authError").textContent = "";

  try {
    const j = await api(
      `/api/auth/${state.tab === "login" ? "login" : "register"}`,
      {
        method: "POST",
        body: JSON.stringify({
          name: $("#name").value,
          email: $("#email").value,
          password: $("#password").value,
        }),
      }
    );

    state.user = j.user;
    showApp();
    await loadAll();
  } catch (x) {
    $("#authError").textContent = x.message;
  }
};

$("#logout").onclick = async () => {
  abortCurrentRequest();
  abortUpload();

  await api("/api/auth/logout", { method: "POST" });
  location.reload();
};

$("#newChat").onclick = async () => {
  abortCurrentRequest();
  abortUpload();

  const j = await api("/api/conversations", { method: "POST" });
  state.chats.unshift(j.conversation);
  await openChat(j.conversation.id);
};

$("#menuBtn").onclick = () =>
  $(".sidebar").classList.toggle("open");

async function loadAll() {
  const [c, p] = await Promise.all([
    api("/api/conversations"),
    api("/api/providers"),
  ]);

  state.chats = c.conversations;
  state.providers = p.providers;

  renderChats();
  renderModels();

  if (!state.chats.length) {
    const j = await api("/api/conversations", { method: "POST" });
    state.chats = [j.conversation];
  }

  await openChat(state.chats[0].id);
}

function renderChats() {
  $("#chatList").innerHTML = state.chats.map((c) =>
    `<button class="chat-item ${state.chat?.id === c.id ? "active" : ""}" onclick="openChat('${c.id}')">${esc(c.title)}</button>`
  ).join("");
}

function renderModels() {
  const opts = [];

  for (const p of state.providers) {
    for (const m of p.models || []) {
      if (m.enabled) {
        opts.push(
          `<option value="${p.id}|${m.id}">${esc(p.name)} — ${esc(m.display_name)}</option>`
        );
      }
    }
  }

  $("#modelSelect").innerHTML = opts.length
    ? opts.join("")
    : `<option value="">No AI model configured</option>`;
}

async function openChat(id) {
  abortCurrentRequest();
  abortUpload();

  const j = await api(`/api/conversations/${id}`);

  state.chat = j.conversation;
  state.files = j.files;

  renderChats();

  $("#chatTitle").textContent = state.chat.title;

  $("#messages").innerHTML =
    j.messages.map((m) =>
      `<div class="msg ${m.role}">${esc(m.content)}</div>`
    ).join("") ||
    `<div class="empty">
      <h2>Start a new chat</h2>
      <p>Upload files or ask the team AI a question.</p>
    </div>`;

  renderFileList();

  $(".sidebar").classList.remove("open");
  $("#messages").scrollTop = 999999;
}

function renderFileList() {
  $("#fileList").innerHTML = state.files.map((f) =>
    `<span class="file-pill">${esc(f.original_name)} · ${esc(f.status)}</span>`
  ).join("");
}

$("#send").onclick = send;

$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

function abortCurrentRequest() {
  if (state.currentRequestController) {
    try {
      state.currentRequestController.abort();
    } catch {}
    state.currentRequestController = null;
  }
}

function abortUpload() {
  if (state.uploadController) {
    try {
      state.uploadController.abort();
    } catch {}
    state.uploadController = null;
  }
}

window.addEventListener("pagehide", () => {
  abortCurrentRequest();
  abortUpload();
});

async function send() {
  const text = $("#input").value.trim();
  const selected = $("#modelSelect").value;

  if (!text || !selected || !state.chat) return;

  abortCurrentRequest();

  const [providerId, modelId] = selected.split("|");
  $("#input").value = "";

  addMsg("user", text);

  const box = addMsg("assistant", "Connecting to AI provider…");
  box.dataset.streaming = "true";
  $("#send").disabled = true;

  const controller = new AbortController();
  state.currentRequestController = controller;

  let gotToken = false;
  let finished = false;

  try {
    const r = await fetch(
      `/api/conversations/${state.chat.id}/messages`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          content: text,
          providerId,
          modelId,
        }),
        signal: controller.signal,
      }
    );

    if (!r.ok) {
      let message = "AI request failed.";
      try {
        const error = await r.json();
        message = error.error || message;
      } catch {}
      throw new Error(message);
    }

    if (!r.body) {
      throw new Error("The server did not return a streaming response.");
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";

    while (true) {
      const result = await reader.read();
      if (result.done) break;

      pending += decoder.decode(result.value, { stream: true });

      const lines = pending.split("\n");
      pending = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, "");

        if (!line || line.startsWith(":") || !line.startsWith("data:")) {
          continue;
        }

        const rawData = line.slice(5).trim();
        if (!rawData) continue;

        let data;
        try {
          data = JSON.parse(rawData);
        } catch {
          continue;
        }

        if (data.status === "connecting") {
          box.textContent = data.message || "Connecting to AI provider…";
          continue;
        }

        if (data.status === "generating") {
          if (!gotToken) {
            box.textContent = data.message || "AI is generating a response…";
          }
          continue;
        }

        if (typeof data.token === "string" && data.token.length > 0) {
          if (!gotToken) {
            gotToken = true;
            box.textContent = "";
          }

          box.textContent += data.token;
          $("#messages").scrollTop = 999999;
        }

        if (data.error) {
          throw new Error(data.error);
        }

        if (data.done === true) {
          finished = true;
          break;
        }
      }

      if (finished) break;
    }

    if (!gotToken && !box.textContent.trim()) {
      box.textContent = "The AI provider returned an empty response.";
    }
  } catch (e) {
    if (e?.name === "AbortError" || controller.signal.aborted) {
      return;
    }

    box.textContent =
      "Error: " +
      (e instanceof Error ? e.message : "AI request failed.");
  } finally {
    if (state.currentRequestController === controller) {
      state.currentRequestController = null;
    }

    $("#send").disabled = false;
    box.dataset.streaming = "false";
  }
}

function addMsg(role, text) {
  $("#messages").querySelector(".empty")?.remove();

  const d = document.createElement("div");
  d.className = `msg ${role}`;
  d.textContent = text;

  $("#messages").appendChild(d);
  $("#messages").scrollTop = 999999;

  return d;
}

$("#fileInput").onchange = async (e) => {
  const files = [...e.target.files];

  for (const f of files) {
    await uploadFile(f);
  }

  e.target.value = "";
};

async function uploadFile(file) {
  if (file.size > 350 * 1024 * 1024) {
    $("#uploadStatus").textContent =
      "Upload error: Maximum file size is 350 MB";
    return;
  }

  if (!state.chat?.id) {
    $("#uploadStatus").textContent =
      "Upload error: Open a conversation first.";
    return;
  }

  abortUpload();

  const controller = new AbortController();
  state.uploadController = controller;

  $("#uploadStatus").textContent =
    `Preparing upload for ${file.name}…`;

  try {
    // Backend route is /api/uploads.
    const s = await api("/api/uploads/start", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || "application/octet-stream",
        conversationId: state.chat.id,
      }),
    });

    if (!s.fileId || !s.uploadId || !s.partSize || !s.parts) {
      throw new Error("Upload service returned an incomplete upload session.");
    }

    const parts = [];

    for (let n = 1; n <= s.parts; n++) {
      if (controller.signal.aborted) {
        throw new DOMException("Upload cancelled", "AbortError");
      }

      const u = await api(
        `/api/uploads/${encodeURIComponent(s.fileId)}/part-url`,
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            uploadId: s.uploadId,
            partNumber: n,
          }),
        }
      );

      // This is the critical fix for the reported "Invalid URL" error.
      // The direct object-storage URL must be a valid absolute HTTP(S) URL.
      const uploadUrl = absoluteUrl(u.url);

      const start = (n - 1) * s.partSize;
      const end = Math.min(file.size, start + s.partSize);

      const rr = await fetch(uploadUrl, {
        method: "PUT",
        body: file.slice(start, end),
        signal: controller.signal,
      });

      if (!rr.ok) {
        const text = await rr.text().catch(() => "");
        throw new Error(
          `Part ${n} upload failed (${rr.status}${text ? `: ${text.slice(0, 180)}` : ""})`
        );
      }

      const etag = rr.headers.get("ETag");

      if (!etag) {
        throw new Error(
          "Storage did not return an ETag. Check bucket CORS: expose the ETag response header."
        );
      }

      parts.push({
        PartNumber: n,
        ETag: etag,
      });

      $("#uploadStatus").textContent =
        `Uploading ${Math.round((n / s.parts) * 100)}%`;
    }

    await api(
      `/api/uploads/${encodeURIComponent(s.fileId)}/complete`,
      {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          uploadId: s.uploadId,
          parts,
        }),
      }
    );

    $("#uploadStatus").textContent = "Processing file…";

    let ready = false;

    for (let i = 0; i < 60 && !ready; i++) {
      if (controller.signal.aborted) {
        throw new DOMException("Upload cancelled", "AbortError");
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const st = await api(
        `/api/uploads/${encodeURIComponent(s.fileId)}/status`,
        { signal: controller.signal }
      );

      ready = st.file.status === "ready";

      if (st.file.status === "failed") {
        throw new Error(
          st.file.processing_error || "Processing failed"
        );
      }
    }

    await openChat(state.chat.id);

    $("#uploadStatus").textContent =
      ready ? "File ready" : "File still processing";
  } catch (e) {
    if (e?.name === "AbortError" || controller.signal.aborted) {
      $("#uploadStatus").textContent = "Upload cancelled";
    } else {
      $("#uploadStatus").textContent =
        "Upload error: " +
        (e instanceof Error ? e.message : "Upload failed");
    }
  } finally {
    if (state.uploadController === controller) {
      state.uploadController = null;
    }
  }
}

$("#adminBtn").onclick = () => {
  $("#adminModal").classList.remove("hidden");
  renderProviders();
};

$("#closeAdmin").onclick = () => {
  $("#adminModal").classList.add("hidden");
};

function renderProviders() {
  $("#providers").innerHTML = state.providers.map((p) =>
    `<div class="provider-row">
      <strong>${esc(p.name)}</strong>
      <div class="status">
        ${esc(p.provider_type)} · ${
          (p.models || []).map((m) => esc(m.display_name)).join(", ") || "no models"
        }
      </div>
      <button onclick="testProvider('${p.id}')">Test</button>
    </div>`
  ).join("");
}

window.testProvider = async (id) => {
  try {
    const j = await api(
      `/api/providers/admin/providers/${encodeURIComponent(id)}/test`,
      { method: "POST" }
    );

    alert(j.success ? j.message : "Failed: " + j.message);
  } catch (e) {
    alert(e.message);
  }
};

$("#providerForm").onsubmit = async (e) => {
  e.preventDefault();

  try {
    await api("/api/providers/admin/providers", {
      method: "POST",
      body: JSON.stringify({
        name: $("#pName").value,
        providerType: $("#pType").value,
        baseUrl: $("#pUrl").value || undefined,
        apiKey: $("#pKey").value,
        models: $("#pModels").value
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => ({
            modelId: x,
            displayName: x,
          })),
      }),
    });

    alert("Provider added");
    e.target.reset();

    const p = await api("/api/providers");
    state.providers = p.providers;

    renderModels();
    renderProviders();
  } catch (x) {
    alert(x.message);
  }
};

document.querySelector('[data-tab="login"]').classList.add("active");
$("#name").classList.add("hidden");

boot();
