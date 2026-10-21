from celery import current_app

from models import Invoice, SessionLocal


class InvoiceService:
    def issue(self, order, discount_code=None):
        session = SessionLocal()
        invoice = Invoice(order_id=order["id"], customer_email=order["customerEmail"])
        invoice.discount_code = discount_code
        invoice.discount_cents = order.get("discountCents", 0)
        session.add(invoice)
        session.commit()
        self.notify(invoice)
        return invoice.id

    def find(self, order_id):
        session = SessionLocal()
        return session.query(Invoice).filter(Invoice.order_id == order_id).first()

    def notify(self, invoice):
        current_app.send_task("receipts.send", args=[invoice.id, invoice.discount_cents])
