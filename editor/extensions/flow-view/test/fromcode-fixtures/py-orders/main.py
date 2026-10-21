from fastapi import FastAPI

from models import Customer, Order, OrderStatus, SessionLocal

app = FastAPI()


def notify(order):
    return order


@app.post("/orders/{order_id}/pay")
def pay_order(order_id: int):
    session = SessionLocal()
    order = session.query(Order).get(order_id)
    if order.status == OrderStatus.NEW:
        order.status = OrderStatus.PAID
        session.commit()
        notify(order)
    return {"ok": True}


@app.get("/customers")
def list_customers():
    session = SessionLocal()
    return session.query(Customer).all()
