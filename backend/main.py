import os, sqlite3, time, hashlib, secrets, uuid
from typing import Optional
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import jwt

load_dotenv()
SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
os.makedirs("uploads", exist_ok=True)


def db():
    c = sqlite3.connect("app.db")
    c.row_factory = sqlite3.Row
    return c


with db() as c:
    c.executescript("""
    create table if not exists users(id integer primary key autoincrement, email text unique, name text, pw text default '', pic text default '');
    create table if not exists reminders(id integer primary key autoincrement, user_id int, title text, description text default '', category text default 'Other', remind_at text, status text default 'pending');
    """)

app = FastAPI(title="Reminder Alarm API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
bearer = HTTPBearer()


def hash_pw(p, salt=None):
    salt = salt or secrets.token_hex(8)
    return salt + "$" + hashlib.pbkdf2_hmac("sha256", p.encode(), salt.encode(), 100_000).hex()


def check_pw(p, h):
    return bool(h) and secrets.compare_digest(hash_pw(p, h.split("$")[0]), h)


def make_token(uid):
    return jwt.encode({"uid": uid, "exp": int(time.time()) + 7 * 86400}, SECRET, algorithm="HS256")


def me(cred: HTTPAuthorizationCredentials = Depends(bearer)):
    try:
        uid = jwt.decode(cred.credentials, SECRET, algorithms=["HS256"])["uid"]
    except Exception:
        raise HTTPException(401, "Session expired. Log in again.")
    with db() as c:
        u = c.execute("select * from users where id=?", (uid,)).fetchone()
    if not u:
        raise HTTPException(401, "Account not found.")
    return dict(u)


class AuthIn(BaseModel):
    email: str
    password: str
    name: Optional[str] = ""


class GoogleIn(BaseModel):
    credential: str


class ReminderIn(BaseModel):
    title: str
    description: str = ""
    category: str = "Other"
    remind_at: str  # ISO 8601, UTC


class ReminderPatch(BaseModel):
    status: Optional[str] = None
    remind_at: Optional[str] = None


@app.post("/api/register")
def register(b: AuthIn):
    email = b.email.strip().lower()
    if not email or len(b.password) < 6:
        raise HTTPException(400, "Enter an email and a password of at least 6 characters.")
    with db() as c:
        if c.execute("select 1 from users where email=?", (email,)).fetchone():
            raise HTTPException(400, "This email is already registered. Log in instead.")
        cur = c.execute("insert into users(email,name,pw) values(?,?,?)", (email, b.name or email.split("@")[0], hash_pw(b.password)))
    return {"token": make_token(cur.lastrowid)}


@app.post("/api/login")
def login(b: AuthIn):
    with db() as c:
        u = c.execute("select * from users where email=?", (b.email.strip().lower(),)).fetchone()
    if not u or not check_pw(b.password, u["pw"]):
        raise HTTPException(400, "Wrong email or password.")
    return {"token": make_token(u["id"])}


@app.post("/api/google")
def google_login(b: GoogleIn):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(400, "Google login is not configured. Set GOOGLE_CLIENT_ID in backend/.env.")
    from google.oauth2 import id_token
    from google.auth.transport import requests as greq
    try:
        info = id_token.verify_oauth2_token(b.credential, greq.Request(), GOOGLE_CLIENT_ID)
    except Exception:
        raise HTTPException(400, "Google sign-in could not be verified.")
    email = info["email"].lower()
    with db() as c:
        u = c.execute("select * from users where email=?", (email,)).fetchone()
        if not u:
            cur = c.execute("insert into users(email,name,pic) values(?,?,?)", (email, info.get("name", email), info.get("picture", "")))
            uid = cur.lastrowid
        else:
            uid = u["id"]
    return {"token": make_token(uid)}


@app.get("/api/me")
def profile(u=Depends(me)):
    return {k: u[k] for k in ("id", "email", "name", "pic")}


@app.post("/api/me/pic")
def upload_pic(file: UploadFile = File(...), u=Depends(me)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        raise HTTPException(400, "Upload a PNG, JPG or WEBP image.")
    name = uuid.uuid4().hex + ext
    with open(f"uploads/{name}", "wb") as f:
        f.write(file.file.read())
    with db() as c:
        c.execute("update users set pic=? where id=?", (f"/uploads/{name}", u["id"]))
    return {"pic": f"/uploads/{name}"}


@app.get("/api/reminders")
def list_reminders(u=Depends(me)):
    with db() as c:
        rows = c.execute("select * from reminders where user_id=? order by remind_at", (u["id"],)).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/reminders")
def create_reminder(b: ReminderIn, u=Depends(me)):
    if not b.title.strip():
        raise HTTPException(400, "Give the reminder a title.")
    with db() as c:
        cur = c.execute("insert into reminders(user_id,title,description,category,remind_at) values(?,?,?,?,?)",
                        (u["id"], b.title.strip(), b.description, b.category, b.remind_at))
    return {"id": cur.lastrowid}


@app.patch("/api/reminders/{rid}")
def update_reminder(rid: int, b: ReminderPatch, u=Depends(me)):
    with db() as c:
        if b.status:
            c.execute("update reminders set status=? where id=? and user_id=?", (b.status, rid, u["id"]))
        if b.remind_at:
            c.execute("update reminders set remind_at=?, status='pending' where id=? and user_id=?", (b.remind_at, rid, u["id"]))
    return {"ok": True}


@app.delete("/api/reminders/{rid}")
def delete_reminder(rid: int, u=Depends(me)):
    with db() as c:
        c.execute("delete from reminders where id=? and user_id=?", (rid, u["id"]))
    return {"ok": True}
