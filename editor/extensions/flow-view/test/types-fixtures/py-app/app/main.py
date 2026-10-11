from fastapi import FastAPI
from app.schemas import UserOut, Address

app = FastAPI()


@app.get("/users/{uid}")
def get_user(uid: int) -> UserOut:
    return UserOut(id=uid)


@app.post("/addresses")
def add_address(body: Address) -> Address:
    return body
