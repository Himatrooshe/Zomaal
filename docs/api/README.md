# Zomaal API Documentation

This folder contains standalone API documentation for frontend development.

## Files

- `openapi.yaml` - OpenAPI 3.0 specification for the verified public API surface.

## How To Use

Open `openapi.yaml` with one of these tools:

- Swagger Editor: https://editor.swagger.io/
- Postman: Import -> Files -> `docs/api/openapi.yaml`
- Insomnia: Import -> From File -> `docs/api/openapi.yaml`

## Notes

- The static file mirrors the verified endpoints shown by the live NestJS Swagger UI.
- Runtime endpoints still undergoing integration testing are intentionally omitted.
- Protected endpoints require `Authorization: Bearer <accessToken>`.
- Provider API keys and secrets are write-only request fields and are never returned.
- Live Swagger is available at `/docs` when `SWAGGER_ENABLED=true`.
