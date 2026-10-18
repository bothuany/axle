from fastapi import FastAPI

from billing.routes import router as billing
from shop.routes import router as shop

app = FastAPI()
app.include_router(billing)
app.include_router(shop)
