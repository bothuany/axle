from celery import shared_task


@shared_task(name="receipts.send")
def send_receipt(invoice_id, discount_cents=0):
    # The receipt lists the discount as its own line, so the customer sees what the code saved.
    return {"invoice": invoice_id, "saved": discount_cents}
