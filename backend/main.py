from pathlib import Path
from datetime import datetime
import sqlite3
import uuid
import shutil

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from deepface import DeepFace

BASE_DIR = Path(__file__).resolve().parent
FACES_DIR = BASE_DIR / "faces"
FACES_DIR.mkdir(exist_ok=True)
DB_PATH = BASE_DIR / "ponto.db"

app = FastAPI(title="Sistema de Ponto Facial", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS employees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                registration TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL,
                face_file TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS punches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id INTEGER NOT NULL,
                punch_type TEXT NOT NULL,
                punch_datetime TEXT NOT NULL,
                FOREIGN KEY(employee_id) REFERENCES employees(id)
            )
        """)

init_db()

def save_upload(upload: UploadFile, destination: Path):
    suffix = Path(upload.filename or "face.jpg").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        suffix = ".jpg"
    destination = destination.with_suffix(suffix)
    with destination.open("wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)
    return destination

@app.get("/")
def home():
    return {"message": "API do Sistema de Registro de Ponto Facial"}

@app.get("/employees")
def list_employees():
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, name, registration, role FROM employees ORDER BY name"
        ).fetchall()
    return [dict(row) for row in rows]

@app.post("/employees")
def create_employee(
    name: str = Form(...),
    registration: str = Form(...),
    role: str = Form(...),
    photo: UploadFile = File(...)
):
    if not name.strip() or not registration.strip() or not role.strip():
        raise HTTPException(status_code=400, detail="Preencha todos os campos.")
    with connect() as conn:
        exists = conn.execute(
            "SELECT id FROM employees WHERE registration = ?", (registration.strip(),)
        ).fetchone()
        if exists:
            raise HTTPException(status_code=409, detail="Já existe funcionário com essa matrícula.")

    filename = f"{uuid.uuid4().hex}"
    image_path = save_upload(photo, FACES_DIR / filename)
    try:
        # Verifica se há um rosto detectável na foto cadastrada.
        DeepFace.extract_faces(
            img_path=str(image_path),
            detector_backend="opencv",
            enforce_detection=True
        )
    except Exception as exc:
        image_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Não foi possível detectar um rosto na foto. Use uma foto frontal e nítida. Detalhe: {str(exc)[:180]}")

    with connect() as conn:
        cursor = conn.execute(
            "INSERT INTO employees (name, registration, role, face_file) VALUES (?, ?, ?, ?)",
            (name.strip(), registration.strip(), role.strip(), str(image_path))
        )
        employee_id = cursor.lastrowid
    return {"message": "Funcionário cadastrado com sucesso.", "id": employee_id}

@app.post("/punch")
def register_punch(
    punch_type: str = Form(...),
    photo: UploadFile = File(...)
):
    allowed = {"Entrada", "Saída", "Intervalo - início", "Intervalo - fim"}
    if punch_type not in allowed:
        raise HTTPException(status_code=400, detail="Tipo de ponto inválido.")

    temp_path = save_upload(photo, BASE_DIR / f"capture_{uuid.uuid4().hex}")
    try:
        with connect() as conn:
            employees = conn.execute(
                "SELECT id, name, registration, role, face_file FROM employees"
            ).fetchall()
        if not employees:
            raise HTTPException(status_code=404, detail="Nenhum funcionário cadastrado.")

        best_match = None
        best_distance = 999.0
        # Compara a captura com cada foto cadastrada.
        for employee in employees:
            try:
                result = DeepFace.verify(
                    img1_path=str(temp_path),
                    img2_path=employee["face_file"],
                    model_name="Facenet",
                    detector_backend="opencv",
                    enforce_detection=True
                )
                distance = float(result.get("distance", 999))
                if result.get("verified") and distance < best_distance:
                    best_match = employee
                    best_distance = distance
            except Exception:
                # Uma foto cadastrada inválida não impede a comparação com as demais.
                continue

        if best_match is None:
            raise HTTPException(status_code=401, detail="Rosto não reconhecido. Tente novamente com boa iluminação ou cadastre o funcionário.")

        now = datetime.now().astimezone().isoformat(timespec="seconds")
        with connect() as conn:
            conn.execute(
                "INSERT INTO punches (employee_id, punch_type, punch_datetime) VALUES (?, ?, ?)",
                (best_match["id"], punch_type, now)
            )
        return {
            "message": "Ponto registrado com sucesso!",
            "employee": {
                "name": best_match["name"],
                "registration": best_match["registration"],
                "role": best_match["role"]
            },
            "punch_type": punch_type,
            "date_time": now,
            "distance": round(best_distance, 4)
        }
    finally:
        temp_path.unlink(missing_ok=True)

@app.get("/punches")
def list_punches():
    with connect() as conn:
        rows = conn.execute("""
            SELECT p.id, e.name, e.registration, p.punch_type, p.punch_datetime
            FROM punches p
            JOIN employees e ON e.id = p.employee_id
            ORDER BY p.id DESC
            LIMIT 100
        """).fetchall()
    return [dict(row) for row in rows]
