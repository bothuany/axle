from fastapi import APIRouter
from sqlalchemy.orm import sessionmaker

from shop.models import Account

router = APIRouter()
SessionLocal = sessionmaker()


@router.get("/shop/accounts")
def list_accounts():
    session = SessionLocal()
    return session.query(Account).all()


@router.post("/shop/accounts")
def create_account():
    session = SessionLocal()
    account = Account()
    session.add(account)
    session.commit()
