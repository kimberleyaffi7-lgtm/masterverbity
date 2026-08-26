# Testing Checklist

## 1. Build

```bash
docker build -t internal-ai-chat:2.0 .
```

Expected: build completes without TypeScript errors.

## 2. Health

```text
GET /api/health
```

Expected:

```json
{"ok":true,"database":"ok","redis":"ok"}
```

## 3. Registration

- Open Create account.
- Register the first account.
- Confirm login succeeds.
- Confirm Admin button is visible.

## 4. Login/logout

- Sign out.
- Sign in again.
- Confirm session persists across page refresh.

## 5. Provider

- Add one AI provider.
- Add at least one model.
- Test the provider.
- Confirm the model appears in the chat model selector.

## 6. Chat

- Create a new chat.
- Send a message.
- Confirm streaming tokens appear.
- Refresh the page.
- Confirm messages persist.

## 7. File upload

Test:

- TXT
- Markdown
- CSV
- JSON
- PDF
- DOCX
- XLSX
- PPTX
- ZIP containing text files
- TAR/TGZ containing text files

Also test a file near the configured 350 MB limit.

## 8. RAG

- Configure an embedding provider.
- Upload a text/PDF/DOCX file.
- Wait for status `ready`.
- Ask a question whose answer is in the file.
- Confirm the response uses file citations such as `[filename:path#chunk]`.

## 9. Security

Confirm:

- API keys are not visible in frontend source.
- `ENCRYPTION_KEY` is only in server environment variables.
- JWT secret is only in server environment variables.
- Cookies are HTTP-only.
- HTTPS is used in production.
- Aiven Valkey uses TLS.
- S3 bucket CORS is limited to the app origin.
