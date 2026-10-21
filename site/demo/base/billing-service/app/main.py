from fastapi import FastAPI

from service import InvoiceService

app = FastAPI()
svc = InvoiceService()


@app.post("/api/invoices")
def create_invoice(body: dict):
    return svc.issue(body)


@app.get("/api/invoices/{order_id}")
def get_invoice(order_id: int):
    return svc.find(order_id)
