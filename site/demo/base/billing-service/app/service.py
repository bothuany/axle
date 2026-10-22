from celery import current_app

from models import Invoice, SessionLocal


class InvoiceService:
    def issue(self, body):
        session = SessionLocal()
        invoice = Invoice()
        session.add(invoice)
        session.commit()
        self.notify(invoice)
        return body

    def find(self, order_id):
        session = SessionLocal()
        return session.query(Invoice).filter(Invoice.order_id == order_id).first()

    def notify(self, invoice):
        current_app.send_task("receipts.send", args=[invoice.id])
