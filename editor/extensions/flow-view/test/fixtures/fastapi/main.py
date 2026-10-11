from fastapi import FastAPI, APIRouter
from .service import UserService
router = APIRouter(prefix="/users")
svc = UserService()

@router.get("/{id}")
def get_user(id: int):
    return svc.find(id)

@router.post("/")
async def create_user(body: dict):
    return svc.create(body)

app = FastAPI()
app.include_router(router)
