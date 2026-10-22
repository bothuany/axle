from celery import shared_task


@shared_task(name="receipts.send")
def send_receipt(invoice_id):
    return invoice_id
