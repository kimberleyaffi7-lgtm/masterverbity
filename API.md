# API Overview

## Health

`GET /api/health`

Returns database and Valkey health.

## Authentication

`POST /api/auth/register`

`POST /api/auth/login`

`POST /api/auth/logout`

`GET /api/auth/me`

## Conversations

`GET /api/conversations`

`POST /api/conversations`

`GET /api/conversations/:id`

`DELETE /api/conversations/:id`

`POST /api/conversations/:id/messages`

The message endpoint streams Server-Sent Events.

## Files

`POST /api/uploads/start`

`POST /api/uploads/:fileId/part-url`

`POST /api/uploads/:fileId/complete`

`GET /api/uploads/:fileId/status`

`DELETE /api/uploads/:fileId`

## Providers

`GET /api/providers`

`POST /api/providers/admin/providers`

`POST /api/providers/admin/providers/:id/test`

`POST /api/providers/admin/providers/:id/models`

`DELETE /api/providers/admin/providers/:id`

## Admin

`GET /api/admin/stats`
