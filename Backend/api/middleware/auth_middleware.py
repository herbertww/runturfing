"""
Runturfing Backend – Auth Middleware
Validates Bearer JWT tokens on protected routes.
Skips auth for /auth/*, /health, /webhooks/*.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
import jwt
from api.config import settings

SKIP_PATHS = {
    "/health",
    "/v1/auth/register",
    "/v1/auth/login",
    "/v1/auth/apple",
    "/v1/auth/refresh",
    "/v1/webhooks/stripe",
    # The school list and the school table are public. Both are read by the
    # marketing site, and the standings are the thing students share into an
    # orientation group chat before any of them has an account.
    "/v1/institutions",
    "/v1/institutions/",
    "/v1/institutions/standings",
}


class AuthMiddleware(BaseHTTPMiddleware):

    async def dispatch(self, request: Request, call_next):
        if request.url.path in SKIP_PATHS or request.url.path.startswith("/docs"):
            return await call_next(request)

        token = _extract_token(request)
        if not token:
            return JSONResponse({"message": "Unauthorized"}, status_code=401)

        try:
            payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
            request.state.user_id = payload["sub"]
            request.state.user_gender = payload.get("gender")
        except jwt.ExpiredSignatureError:
            return JSONResponse({"message": "Token expired"}, status_code=401)
        except jwt.InvalidTokenError:
            return JSONResponse({"message": "Invalid token"}, status_code=401)

        return await call_next(request)


def _extract_token(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None
