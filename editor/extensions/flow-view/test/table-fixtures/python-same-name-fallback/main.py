from fastapi import FastAPI

from api.routes import router as api
from billing.routes import router as billing

app = FastAPI()
app.include_router(api)
app.include_router(billing)
