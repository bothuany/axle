from celery import shared_task


@shared_task
def send_email(user_id):
    return user_id


@shared_task(name="reports.build")
def build_report(day):
    return day
