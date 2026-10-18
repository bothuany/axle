from fastapi import FastAPI

from models import Order, SessionLocal

app = FastAPI()


@app.get("/orders")
def list_orders():
    session = SessionLocal()
    return session.query(Order).filter(Order.status == "open").all()


@app.post("/orders")
def create_order(email: str):
    session = SessionLocal()
    order = Order()
    session.add(order)
    session.commit()
    return {"ok": True}
