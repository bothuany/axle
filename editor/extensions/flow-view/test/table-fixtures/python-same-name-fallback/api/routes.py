from fastapi import APIRouter
from sqlalchemy.orm import sessionmaker

router = APIRouter()
SessionLocal = sessionmaker()


@router.get("/api/accounts")
def list_accounts():
    session = SessionLocal()
    return session.query(Account).all()
