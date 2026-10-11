from fastapi import FastAPI
app = FastAPI()

@app.get("/pay")
def pay(gateway):
    return gateway.audit(5)
