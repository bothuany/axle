from fastapi import APIRouter
from sqlalchemy.orm import sessionmaker

from billing.models import *

router = APIRouter()
SessionLocal = sessionmaker()


@router.get("/billing/accounts")
def list_accounts():
    session = SessionLocal()
    return session.query(Account).all()
