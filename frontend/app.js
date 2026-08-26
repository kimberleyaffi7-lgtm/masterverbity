const $ = (s) => document.querySelector(s);

const state = {
  user: null,
  tab: "login",
  chat: null,
  chats: [],
  providers: [],
  files: [],
  currentRequestController: null,
};

async function api(url, opt = {}) {
  const r = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(opt.headers || {}),
    },
    ...opt,
  });

  const j = await r
    .json()
    .catch(() => ({}));

  if (!r.ok) {
    throw new Error(
      j.error || "Request failed"
    );
  }

  return j;
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]
  );
}

async function boot() {
  try {
    const j = await api(
      "/api/auth/me"
    );

    state.user = j.user;

    showApp();

    await loadAll();
  } catch {
    showAuth();
  }
}

function showAuth() {
  $("#authView").classList.remove(
    "hidden"
  );

  $("#appView").classList.add(
    "hidden"
  );
}

function showApp() {
  $("#authView").classList.add(
    "hidden"
  );

  $("#appView").classList.remove(
    "hidden"
  );

  $("#userLabel").textContent =
    state.user.email;

  if (
    state.user.role === "admin"
  ) {
    $("#adminBtn").classList.remove(
      "hidden"
    );
  }
}

document
  .querySelectorAll("[data-tab]")
  .forEach((b) => {
    b.onclick = () => {
      state.tab = b.dataset.tab;

      document
        .querySelectorAll("[data-tab]")
        .forEach((x) =>
          x.classList.toggle(
            "active",
            x === b
          )
        );

      $("#name").classList.toggle(
        "hidden",
        state.tab === "login"
      );
    };
  });

$("#authForm").onsubmit = async (e) => {
  e.preventDefault();

  $("#authError").textContent = "";

  try {
    const j = await api(
      `/api/auth/${
        state.tab === "login"
          ? "login"
          : "register"
      }`,
      {
        method: "POST",
        body: JSON.stringify({
          name: $("#name").value,
          email: $("#email").value,
          password:
            $("#password").value,
        }),
      }
    );

    state.user = j.user;

    showApp();

    await loadAll();
  } catch (x) {
    $("#authError").textContent =
      x.message;
  }
};

$("#logout").onclick = async () => {
  abortCurrentRequest();

  await api(
    "/api/auth/logout",
    {
      method: "POST",
    }
  );

  location.reload();
};

$("#newChat").onclick = async () => {
  abortCurrentRequest();

  const j = await api(
    "/api/conversations",
    {
      method: "POST",
    }
  );

  state.chats.unshift(
    j.conversation
  );

  openChat(
    j.conversation.id
  );
};

$("#menuBtn").onclick = () =>
  $(".sidebar").classList.toggle(
    "open"
  );

async function loadAll() {
  const [c, p] =
    await Promise.all([
      api("/api/conversations"),
      api("/api/providers"),
    ]);

  state.chats =
    c.conversations;

  state.providers =
    p.providers;

  renderChats();

  renderModels();

  if (!state.chats.length) {
    const j = await api(
      "/api/conversations",
      {
        method: "POST",
      }
    );

    state.chats = [
      j.conversation,
    ];
  }

  openChat(
    state.chats[0].id
  );
}

function renderChats() {
  $("#chatList").innerHTML =
    state.chats
      .map(
        (c) =>
          `<button class="chat-item ${
            state.chat?.id === c.id
              ? "active"
              : ""
          }" onclick="openChat('${c.id}')">${esc(
            c.title
          )}</button>`
      )
      .join("");
}

function renderModels() {
  const opts = [];

  for (const p of state.providers) {
    for (const m of p.models || []) {
      if (m.enabled) {
        opts.push(
          `<option value="${p.id}|${m.id}">${esc(
            p.name
          )} — ${esc(
            m.display_name
          )}</option>`
        );
      }
    }
  }

  $("#modelSelect").innerHTML =
    opts.length
      ? opts.join("")
      : `<option value="">No AI model configured</option>`;
}

async function openChat(id) {
  abortCurrentRequest();

  const j = await api(
    `/api/conversations/${id}`
  );

  state.chat =
    j.conversation;

  state.files =
    j.files;

  renderChats();

  $("#chatTitle").textContent =
    state.chat.title;

  $("#messages").innerHTML =
    j.messages
      .map(
        (m) =>
          `<div class="msg ${m.role}">${esc(
            m.content
          )}</div>`
      )
      .join("") ||
    `<div class="empty">
      <h2>Start a new chat</h2>
      <p>Upload files or ask the team AI a question.</p>
    </div>`;

  $("#fileList").innerHTML =
    state.files
      .map(
        (f) =>
          `<span class="file-pill">${esc(
            f.original_name
          )} · ${esc(
            f.status
          )}</span>`
      )
      .join("");

  $(".sidebar").classList.remove(
    "open"
  );

  $("#messages").scrollTop =
    999999;
}

$("#send").onclick = send;

$("#input").addEventListener(
  "keydown",
  (e) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey
    ) {
      e.preventDefault();

      send();
    }
  }
);

function abortCurrentRequest() {
  if (
    state.currentRequestController
  ) {
    try {
      state.currentRequestController.abort();
    } catch {
      // Already aborted.
    }

    state.currentRequestController =
      null;
  }
}

/*
 * If the user navigates away, closes the tab,
 * refreshes the page, or leaves the application,
 * abort the active AI request.
 */
window.addEventListener(
  "pagehide",
  () => {
    abortCurrentRequest();
  }
);

async function send() {
  const text =
    $("#input").value.trim();

  const selected =
    $("#modelSelect").value;

  if (
    !text ||
    !selected ||
    !state.chat
  ) {
    return;
  }

  /*
   * Cancel any previous request.
   */
  abortCurrentRequest();

  const [
    providerId,
    modelId,
  ] = selected.split("|");

  $("#input").value = "";

  addMsg("user", text);

  const box = addMsg(
    "assistant",
    "Connecting to AI provider…"
  );

  box.dataset.streaming = "true";

  $("#send").disabled = true;

  const controller =
    new AbortController();

  state.currentRequestController =
    controller;

  let gotToken = false;
  let finished = false;

  try {
    const r = await fetch(
      `/api/conversations/${state.chat.id}/messages`,
      {
        method: "POST",

        credentials: "include",

        headers: {
          "Content-Type":
            "application/json",
          Accept:
            "text/event-stream",
        },

        body: JSON.stringify({
          content: text,
          providerId,
          modelId,
        }),

        signal:
          controller.signal,
      }
    );

    if (!r.ok) {
      let message =
        "AI request failed.";

      try {
        const error =
          await r.json();

        message =
          error.error ||
          message;
      } catch {
        // Ignore invalid JSON.
      }

      throw new Error(message);
    }

    if (!r.body) {
      throw new Error(
        "The server did not return a streaming response."
      );
    }

    const reader =
      r.body.getReader();

    const decoder =
      new TextDecoder();

    let pending = "";

    while (true) {
      const result =
        await reader.read();

      if (result.done) {
        break;
      }

      pending += decoder.decode(
        result.value,
        {
          stream: true,
        }
      );

      const lines =
        pending.split("\n");

      pending =
        lines.pop() || "";

      for (const rawLine of lines) {
        const line =
          rawLine.replace(
            /\r$/,
            ""
          );

        /*
         * Ignore SSE comments such as:
         *
         * : heartbeat
         */
        if (
          !line ||
          line.startsWith(":")
        ) {
          continue;
        }

        if (
          !line.startsWith("data:")
        ) {
          continue;
        }

        const rawData =
          line
            .slice(5)
            .trim();

        if (!rawData) {
          continue;
        }

        let data;

        try {
          data =
            JSON.parse(rawData);
        } catch {
          /*
           * Do not crash the stream because of
           * an incomplete/malformed SSE fragment.
           */
          continue;
        }

        /*
         * Server status event.
         */
        if (
          data.status ===
          "connecting"
        ) {
          box.textContent =
            data.message ||
            "Connecting to AI provider…";

          continue;
        }

        /*
         * Server status after provider connection.
         */
        if (
          data.status ===
          "generating"
        ) {
          if (!gotToken) {
            box.textContent =
              data.message ||
              "AI is generating a response…";
          }

          continue;
        }

        /*
         * Normal streamed token.
         */
        if (
          typeof data.token ===
            "string" &&
          data.token.length > 0
        ) {
          if (!gotToken) {
            gotToken = true;

            /*
             * Remove the temporary status text
             * before writing the first real token.
             */
            box.textContent = "";
          }

          box.textContent +=
            data.token;

          $("#messages").scrollTop =
            999999;
        }

        /*
         * Proper terminal event.
         */
        if (data.done === true) {
          finished = true;

          break;
        }

        /*
         * Backend/provider error.
         */
        if (data.error) {
          throw new Error(
            data.error
          );
        }
      }

      if (finished) {
        break;
      }
    }

    /*
     * If the server closed normally without
     * any tokens, show a useful message.
     */
    if (
      !gotToken &&
      !box.textContent.trim()
    ) {
      box.textContent =
        "The AI provider returned an empty response.";
    }
  } catch (e) {
    /*
     * Abort caused by the user leaving the page
     * is not displayed as an error.
     */
    if (
      e?.name ===
        "AbortError" ||
      controller.signal.aborted
    ) {
      return;
    }

    box.textContent =
      "Error: " +
      (
        e instanceof Error
          ? e.message
          : "AI request failed."
      );
  } finally {
    if (
      state.currentRequestController ===
      controller
    ) {
      state.currentRequestController =
        null;
    }

    $("#send").disabled = false;

    box.dataset.streaming = "false";
  }
}

function addMsg(role, text) {
  $(
    "#messages"
  )
    .querySelector(".empty")
    ?.remove();

  const d =
    document.createElement(
      "div"
    );

  d.className =
    `msg ${role}`;

  d.textContent = text;

  $("#messages").appendChild(d);

  $("#messages").scrollTop =
    999999;

  return d;
}

$("#fileInput").onchange =
  async (e) => {
    for (const f of [
      ...e.target.files,
    ]) {
      await uploadFile(f);
    }

    e.target.value = "";
  };

async function uploadFile(file) {
  if (
    file.size >
    350 * 1024 * 1024
  ) {
    alert(
      "Maximum file size is 350 MB"
    );

    return;
  }

  $("#uploadStatus").textContent =
    `Uploading ${file.name}…`;

  try {
    const s = await api(
      "/api/uploads/start",
      {
        method: "POST",

        body: JSON.stringify({
          fileName:
            file.name,
          fileSize:
            file.size,
          contentType:
            file.type,
          conversationId:
            state.chat.id,
        }),
      }
    );

    const parts = [];

    for (
      let n = 1;
      n <= s.parts;
      n++
    ) {
      const u = await api(
        `/api/uploads/${s.fileId}/part-url`,
        {
          method: "POST",

          body: JSON.stringify({
            uploadId:
              s.uploadId,
            partNumber: n,
          }),
        }
      );

      const start =
        (n - 1) *
        s.partSize;

      const end =
        Math.min(
          file.size,
          start +
            s.partSize
        );

      const rr =
        await fetch(
          u.url,
          {
            method: "PUT",
            body: file.slice(
              start,
              end
            ),
          }
        );

      if (!rr.ok) {
        throw new Error(
          "Part upload failed"
        );
      }

      parts.push({
        PartNumber: n,
        ETag:
          rr.headers.get(
            "ETag"
          ) || "",
      });

      $(
        "#uploadStatus"
      ).textContent =
        `Uploading ${Math.round(
          (n / s.parts) * 100
        )}%`;
    }

    await api(
      `/api/uploads/${s.fileId}/complete`,
      {
        method: "POST",

        body: JSON.stringify({
          uploadId:
            s.uploadId,
          parts,
        }),
      }
    );

    $(
      "#uploadStatus"
    ).textContent =
      "Processing file…";

    let ready = false;

    for (
      let i = 0;
      i < 60 && !ready;
      i++
    ) {
      await new Promise(
        (r) =>
          setTimeout(
            r,
            1500
          )
      );

      const st =
        await api(
          `/api/uploads/${s.fileId}/status`
        );

      ready =
        st.file.status ===
        "ready";

      if (
        st.file.status ===
        "failed"
      ) {
        throw new Error(
          st.file.processing_error ||
            "Processing failed"
        );
      }
    }

    await openChat(
      state.chat.id
    );

    $(
      "#uploadStatus"
    ).textContent = ready
      ? "File ready"
      : "File still processing";
  } catch (e) {
    $(
      "#uploadStatus"
    ).textContent =
      "Upload error: " +
      e.message;
  }
}

$("#adminBtn").onclick = () => {
  $("#adminModal").classList.remove(
    "hidden"
  );

  renderProviders();
};

$("#closeAdmin").onclick = () => {
  $("#adminModal").classList.add(
    "hidden"
  );
};

function renderProviders() {
  $("#providers").innerHTML =
    state.providers
      .map(
        (p) =>
          `<div class="provider-row">
            <strong>${esc(
              p.name
            )}</strong>
            <div class="status">
              ${esc(
                p.provider_type
              )} · ${
                (p.models || [])
                  .map(
                    (m) =>
                      esc(
                        m.display_name
                      )
                  )
                  .join(
                    ", "
                  ) ||
                "no models"
              }
            </div>
            <button onclick="testProvider('${p.id}')">
              Test
            </button>
          </div>`
      )
      .join("");
}

window.testProvider =
  async (id) => {
    const j = await api(
      `/api/providers/admin/providers/${id}/test`,
      {
        method: "POST",
      }
    );

    alert(
      j.success
        ? j.message
        : "Failed: " +
            j.message
    );
  };

$("#providerForm").onsubmit =
  async (e) => {
    e.preventDefault();

    try {
      await api(
        "/api/providers/admin/providers",
        {
          method: "POST",

          body: JSON.stringify({
            name:
              $("#pName").value,

            providerType:
              $("#pType").value,

            baseUrl:
              $("#pUrl").value ||
              undefined,

            apiKey:
              $("#pKey").value,

            models:
              $("#pModels")
                .value
                .split(",")
                .map(
                  (x) =>
                    x.trim()
                )
                .filter(
                  Boolean
                )
                .map(
                  (x) => ({
                    modelId: x,
                    displayName:
                      x,
                  })
                ),
          }),
        }
      );

      alert(
        "Provider added"
      );

      e.target.reset();

      const p =
        await api(
          "/api/providers"
        );

      state.providers =
        p.providers;

      renderModels();

      renderProviders();
    } catch (x) {
      alert(x.message);
    }
  };

document
  .querySelector(
    '[data-tab="login"]'
  )
  .classList.add("active");

$("#name").classList.add(
  "hidden"
);

boot();
