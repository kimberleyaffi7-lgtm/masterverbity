import type { AIProvider, ChatRequest } from "./types.js";

const PROVIDER_TIMEOUT_MS = 30_000;
const FIRST_TOKEN_TIMEOUT_MS = 20_000;

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.toLowerCase().includes("aborted"))
  );
}

function createTimeoutController(
  parentSignal?: AbortSignal,
  timeoutMs = PROVIDER_TIMEOUT_MS
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();

  const onParentAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason);
    }
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(
        new DOMException("Provider request timed out", "TimeoutError")
      );
    }
  }, timeoutMs);

  const cleanup = () => {
    clearTimeout(timer);

    if (parentSignal) {
      parentSignal.removeEventListener("abort", onParentAbort);
    }
  };

  return { controller, cleanup };
}

function createReadTimeout(
  parentSignal: AbortSignal,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();

  const onParentAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal.reason);
    }
  };

  if (parentSignal.aborted) {
    onParentAbort();
  } else {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(
        new DOMException("AI provider did not send data in time", "TimeoutError")
      );
    }
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onParentAbort);
    },
  };
}

function providerErrorMessage(status: number, body: string): string {
  const cleanBody = body
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

  if (status === 401 || status === 403) {
    return "AI provider authentication failed. Please check the API key.";
  }

  if (status === 404) {
    return "AI provider model or endpoint was not found. Please check the provider URL and model ID.";
  }

  if (status === 408 || status === 504) {
    return "AI provider timed out. Please try again.";
  }

  if (status === 429) {
    return "AI provider rate limit reached. Please wait a moment and try again.";
  }

  if (status >= 500) {
    return "AI provider is temporarily unavailable. Please try again.";
  }

  return cleanBody
    ? `AI provider returned an error (${status}): ${cleanBody}`
    : `AI provider returned an error (${status}).`;
}

export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    private baseUrl: string,
    private apiKey: string
  ) {}

  async *streamChat(
    request: ChatRequest
  ): AsyncGenerator<string, void, unknown> {
    const endpoint = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const { controller, cleanup } = createTimeoutController(
      request.signal,
      PROVIDER_TIMEOUT_MS
    );

    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.3,
          ...(request.maxTokens
            ? { max_tokens: request.maxTokens }
            : {}),
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      cleanup();

      if (request.signal?.aborted || isAbortError(error)) {
        if (request.signal?.aborted) {
          throw error;
        }

        throw new Error(
          "AI provider request timed out while connecting."
        );
      }

      throw new Error(
        `Could not connect to AI provider: ${
          error instanceof Error ? error.message : "Network error"
        }`
      );
    }

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "");
      cleanup();

      throw new Error(providerErrorMessage(response.status, body));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let pending = "";
    let receivedFirstToken = false;

    try {
      while (true) {
        /*
         * The first read gets its own timeout.
         *
         * This prevents the UI from sitting blank forever after
         * the provider has accepted the request but has not produced
         * any response data.
         */
        const readTimeout = receivedFirstToken
          ? null
          : createReadTimeout(
              controller.signal,
              FIRST_TOKEN_TIMEOUT_MS
            );

        let result: ReadableStreamReadResult<Uint8Array>;

        try {
          result = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
              if (!readTimeout) return;

              const onAbort = () => {
                reject(
                  controller.signal.reason ??
                    new DOMException(
                      "First token timeout",
                      "TimeoutError"
                    )
                );
              };

              if (readTimeout.signal.aborted) {
                onAbort();
                return;
              }

              readTimeout.signal.addEventListener(
                "abort",
                onAbort,
                { once: true }
              );
            }),
          ]);
        } catch (error) {
          if (
            !receivedFirstToken &&
            !request.signal?.aborted
          ) {
            throw new Error(
              "AI provider connected but did not send a response within 20 seconds."
            );
          }

          throw error;
        } finally {
          readTimeout?.cleanup();
        }

        if (result.done) {
          break;
        }

        pending += decoder.decode(result.value, {
          stream: true,
        });

        const lines = pending.split("\n");

        pending = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, "");

          if (!line.startsWith("data:")) {
            continue;
          }

          const data = line.slice(5).trim();

          if (!data) {
            continue;
          }

          /*
           * Correct OpenAI-compatible stream termination.
           */
          if (data === "[DONE]") {
            return;
          }

          try {
            const event = JSON.parse(data);

            /*
             * Some OpenAI-compatible gateways return:
             *
             * { error: { message: "..." } }
             */
            if (event?.error) {
              const message =
                typeof event.error === "string"
                  ? event.error
                  : event.error?.message;

              throw new Error(
                message || "AI provider returned an error."
              );
            }

            const token =
              event?.choices?.[0]?.delta?.content;

            if (typeof token === "string" && token.length > 0) {
              receivedFirstToken = true;
              yield token;
            }
          } catch (error) {
            /*
             * JSON parsing errors are ignored because some providers
             * can split SSE payloads across chunks.
             *
             * Actual provider errors are re-thrown.
             */
            if (
              error instanceof Error &&
              !error.message.includes("Unexpected token") &&
              !error.message.includes("JSON")
            ) {
              throw error;
            }
          }
        }
      }
    } catch (error) {
      if (request.signal?.aborted) {
        throw error;
      }

      if (isAbortError(error)) {
        throw new Error(
          receivedFirstToken
            ? "AI provider connection timed out."
            : "AI provider did not respond in time."
        );
      }

      throw error;
    } finally {
      cleanup();

      try {
        reader.releaseLock();
      } catch {
        // Reader may already be released.
      }
    }
  }

  async createEmbeddings(texts: string[]) {
    const { controller, cleanup } = createTimeoutController(
      undefined,
      PROVIDER_TIMEOUT_MS
    );

    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}/embeddings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model:
              process.env.EMBEDDING_MODEL ??
              "text-embedding-3-small",
            input: texts,
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          providerErrorMessage(response.status, body)
        );
      }

      const json = (await response.json()) as any;

      return (json.data ?? [])
        .sort(
          (a: any, b: any) =>
            a.index - b.index
        )
        .map((x: any) => x.embedding);
    } finally {
      cleanup();
    }
  }

  async testConnection() {
    const { controller, cleanup } =
      createTimeoutController(
        undefined,
        15_000
      );

    try {
      const r = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}/models`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          signal: controller.signal,
        }
      );

      if (r.ok) {
        return {
          success: true,
          message: "Connection successful",
        };
      }

      const body = await r.text().catch(() => "");

      return {
        success: false,
        message: providerErrorMessage(
          r.status,
          body
        ),
      };
    } catch (e) {
      return {
        success: false,
        message:
          e instanceof Error
            ? e.message
            : "Connection failed",
      };
    } finally {
      cleanup();
    }
  }
}
