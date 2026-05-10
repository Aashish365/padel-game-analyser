import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from api.ws_handler import router as ws_router, _session

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Padel Analytics API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(ws_router)


@app.get("/status")
def status():
    import torch
    return {
        "status": "ok",
        "gpu":    torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
        "model":  "yolo11n-pose",
    }


@app.post("/upload")
async def upload_video(file: UploadFile):
    ext   = Path(file.filename).suffix or ".mp4"
    fpath = UPLOAD_DIR / f"{uuid.uuid4().hex}{ext}"
    fpath.write_bytes(await file.read())
    return {"file_path": str(fpath)}


@app.get("/shots.json")
def export_shots_json():
    from fastapi.responses import Response
    import json
    shots = _session["shots"]
    payload = {
        "shots":     shots,
        "total":     len(shots),
        "by_player": _session["counts"],
    }
    return Response(content=json.dumps(payload, indent=2),
                    media_type="application/json",
                    headers={"Content-Disposition": "attachment; filename=shots.json"})


@app.get("/shots.csv")
def export_shots_csv():
    from fastapi.responses import Response
    import csv, io
    shots = _session["shots"]
    if not shots:
        return Response(content="", media_type="text/csv")
    f = io.StringIO()
    rows = []
    for s in shots:
        row = dict(s)
        cp = row.pop("court_pos", None) or [None, None]
        bc = row.pop("ball_court", None) or [None, None]
        row["player_cx"] = cp[0]; row["player_cy"] = cp[1]
        row["ball_cx"]   = bc[0]; row["ball_cy"]   = bc[1]
        rows.append(row)
    writer = csv.DictWriter(f, fieldnames=rows[0].keys())
    writer.writeheader(); writer.writerows(rows)
    return Response(content=f.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=shots.csv"})
