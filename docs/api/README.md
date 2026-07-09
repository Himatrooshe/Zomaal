# Zomaal API Documentation

This folder contains standalone API documentation for frontend development.

## Files

- `openapi.yaml` - OpenAPI 3.0 specification for the current Zomaal backend.

## How To Use

Open `openapi.yaml` with one of these tools:

- Swagger Editor: https://editor.swagger.io/
- Postman: Import -> Files -> `docs/api/openapi.yaml`
- Insomnia: Import -> From File -> `docs/api/openapi.yaml`

## Notes

- This documentation is intentionally separate from the NestJS source code.
- Protected endpoints require `Authorization: Bearer <accessToken>`.
- Sendit webhook endpoint is public because Sendit calls it directly.
- Sendit responses are proxied from Sendit.ma, so exact nested response fields may change with their API.
