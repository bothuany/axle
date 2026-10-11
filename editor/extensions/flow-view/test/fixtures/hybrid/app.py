from fastapi import FastAPI
app = FastAPI()

@app.get("/pay")
def pay(gateway, other):
    gateway.charge_card(5)
    return other.refund_money(3)
