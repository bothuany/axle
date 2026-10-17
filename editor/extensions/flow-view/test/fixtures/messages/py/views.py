from celery import current_app
from fastapi import FastAPI
from tasks import send_email

app = FastAPI()


@app.post("/signup")
def signup(user_id: int):
    send_email.delay(user_id)
    return {}


@app.post("/reports")
def reports(day: str):
    current_app.send_task("reports.build", args=[day])
    return {}
