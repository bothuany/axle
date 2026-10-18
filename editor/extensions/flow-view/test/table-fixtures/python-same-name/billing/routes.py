from fastapi import APIRouter
from sqlalchemy.orm import sessionmaker

from billing.models import Account

router = APIRouter()
SessionLocal = sessionmaker()


@router.get("/billing/accounts")
def list_accounts():
    session = SessionLocal()
    return session.query(Account).all()


@router.post("/billing/accounts")
def create_account():
    session = SessionLocal()
    account = Account()
    session.add(account)
    session.commit()
