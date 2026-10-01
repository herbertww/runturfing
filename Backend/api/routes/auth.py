"""
Runturfing Backend – Auth Routes
POST /auth/register   – Email + password sign up
POST /auth/login      – Email + password sign in
POST /auth/apple      – Sign in with Apple
POST /auth/refresh    – Refresh access token
POST /auth/logout     – Stateless logout (client clears tokens)
GET  /auth/me         – Current user session
POST /auth/push-token – Register device push token
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext
from typing import Optional
from datetime import datetime, date, timedelta, timezone
import uuid
import jwt
from jwt import PyJWKClient

from api.database import get_db
from api.config import settings

router = APIRouter()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALLOWED_GENDERS = {"male", "female", "non_binary", "prefer_not_to_say"}

# Apple's published JWKS — PyJWKClient caches keys internally.
APPLE_ISSUER = "https://appleid.apple.com"
_apple_jwks = PyJWKClient("https://appleid.apple.com/auth/keys")


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str
    gender: str = "prefer_not_to_say"
    # Required: Runturfing is 18+. The client age gate is a courtesy; this is the
    # enforcement point, since a client-side check is trivially bypassed.
    date_of_birth: date


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AppleSignInRequest(BaseModel):
    identity_token: str
    full_name: Optional[str] = None


class RefreshRequest(BaseModel):
    refresh_token: str


class PushTokenRequest(BaseModel):
    token: str
    platform: str = "android"


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_at: datetime
    user: dict


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_tokens(user_id: str, gender: str) -> tuple[str, str, datetime]:
    now = datetime.now(timezone.utc)
    expiry = now + timedelta(minutes=settings.jwt_expiry_minutes)
    access = jwt.encode(
        {"sub": user_id, "gender": gender, "iat": now, "exp": expiry},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    refresh_expiry = now + timedelta(days=settings.jwt_refresh_expiry_days)
    refresh = jwt.encode(
        {"sub": user_id, "type": "refresh", "iat": now, "exp": refresh_expiry},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    return access, refresh, expiry


def _is_adult(dob: Optional[date]) -> bool:
    if not dob:
        return False
    today = date.today()
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    return age >= 18


def _verify_apple_token(identity_token: str) -> dict:
    """
    Verify an Apple identity token against Apple's published public keys (JWKS),
    checking signature, audience (our client id), and issuer.
    Returns the decoded payload (with 'sub' = stable Apple user id).
    """
    try:
        signing_key = _apple_jwks.get_signing_key_from_jwt(identity_token)
        return jwt.decode(
            identity_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.apple_client_id,
            issuer=APPLE_ISSUER,
        )
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid Apple token: {e}")


async def _create_user(
    db: AsyncSession,
    *,
    display_name: str,
    gender: str,
    apple_sub: Optional[str] = None,
    email: Optional[str] = None,
    password_hash: Optional[str] = None,
    age_verified: bool = False,
) -> str:
    """Insert a user row plus its default profile; returns the new user id."""
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            """INSERT INTO users
                   (id, apple_sub, email, password_hash, display_name, gender, age_verified)
               VALUES (:id, :apple_sub, :email, :pw, :name, :gender, :age)"""
        ).bindparams(
            id=user_id, apple_sub=apple_sub, email=email, pw=password_hash,
            name=display_name, gender=gender, age=age_verified,
        )
    )
    await db.execute(
        text("INSERT INTO profiles (user_id) VALUES (:uid)").bindparams(uid=user_id)
    )
    return user_id


def _auth_response(user_id: str, gender: str, user: dict) -> AuthResponse:
    access, refresh, expiry = _make_tokens(user_id, gender)
    return AuthResponse(access_token=access, refresh_token=refresh, expires_at=expiry, user=user)


# ---------------------------------------------------------------------------
# Email / password
# ---------------------------------------------------------------------------

@router.post("/register", response_model=AuthResponse)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    if body.gender not in ALLOWED_GENDERS:
        raise HTTPException(status_code=422, detail=f"gender must be one of {sorted(ALLOWED_GENDERS)}")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    existing = await db.execute(
        text("SELECT 1 FROM users WHERE email = :email").bindparams(email=body.email)
    )
    if existing.fetchone():
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    age_verified = _is_adult(body.date_of_birth)
    if not age_verified:
        raise HTTPException(status_code=403, detail="You must be 18 or older to use Runturfing")

    user_id = await _create_user(
        db,
        display_name=body.display_name,
        gender=body.gender,
        email=body.email,
        password_hash=pwd_context.hash(body.password),
        age_verified=age_verified,
    )
    if body.date_of_birth:
        await db.execute(
            text("UPDATE users SET date_of_birth = :dob WHERE id = :id")
            .bindparams(dob=body.date_of_birth, id=user_id)
        )
    # get_db commits on successful return.

    return _auth_response(user_id, body.gender, {
        "id": user_id, "email": body.email, "display_name": body.display_name,
        "gender": body.gender, "age_verified": age_verified,
    })


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("SELECT id, password_hash, display_name, gender, age_verified FROM users WHERE email = :email")
        .bindparams(email=body.email)
    )
    row = result.fetchone()
    # Verify even on missing user to avoid leaking which emails exist (timing).
    password_hash = row[1] if row else None
    if not password_hash or not pwd_context.verify(body.password, password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user_id, _, display_name, gender, age_verified = row
    return _auth_response(str(user_id), gender, {
        "id": str(user_id), "email": body.email, "display_name": display_name,
        "gender": gender, "age_verified": age_verified,
    })


@router.post("/logout")
async def logout():
    # JWTs are stateless; the client discards its stored tokens. Endpoint exists
    # so the client has a stable call, and as a hook for future token revocation.
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Apple Sign In
# ---------------------------------------------------------------------------

@router.post("/apple", response_model=AuthResponse)
async def sign_in_with_apple(body: AppleSignInRequest, db: AsyncSession = Depends(get_db)):
    payload = _verify_apple_token(body.identity_token)
    apple_sub = payload.get("sub")
    if not apple_sub:
        raise HTTPException(status_code=401, detail="Missing Apple subject")

    result = await db.execute(
        text("SELECT id, display_name, gender, age_verified FROM users WHERE apple_sub = :sub")
        .bindparams(sub=apple_sub)
    )
    row = result.fetchone()

    if row:
        user_id, user_name, gender, age_verified = str(row[0]), row[1], row[2], row[3]
    else:
        gender = "prefer_not_to_say"
        age_verified = False
        user_name = body.full_name or "Runner"
        user_id = await _create_user(
            db,
            display_name=user_name,
            gender=gender,
            apple_sub=apple_sub,
            email=payload.get("email"),
        )

    return _auth_response(user_id, gender, {
        "id": user_id, "display_name": user_name, "gender": gender, "age_verified": age_verified,
    })


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

@router.post("/refresh", response_model=AuthResponse)
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        payload = jwt.decode(body.refresh_token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Not a refresh token")
        user_id = payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    result = await db.execute(
        text("SELECT email, display_name, gender, age_verified FROM users WHERE id = :uid")
        .bindparams(uid=user_id)
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    return _auth_response(user_id, row[2], {
        "id": user_id, "email": row[0], "display_name": row[1],
        "gender": row[2], "age_verified": row[3],
    })


@router.get("/me")
async def get_me(request: Request, db: AsyncSession = Depends(get_db)):
    user_id = request.state.user_id
    result = await db.execute(
        text("SELECT id, email, display_name, gender, age_verified, city, created_at FROM users WHERE id = :uid")
        .bindparams(uid=user_id)
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": str(row[0]),
        "email": row[1],
        "display_name": row[2],
        "gender": row[3],
        "age_verified": row[4],
        "city": row[5],
        "created_at": row[6].isoformat() if row[6] else None,
    }


@router.post("/push-token")
async def register_push_token(
    body: PushTokenRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    user_id = request.state.user_id
    await db.execute(
        text("""
            INSERT INTO push_tokens (user_id, token, platform)
            VALUES (:uid, :token, :platform)
            ON CONFLICT (token) DO UPDATE SET user_id = :uid
        """).bindparams(uid=user_id, token=body.token, platform=body.platform)
    )
    return {"status": "ok"}
