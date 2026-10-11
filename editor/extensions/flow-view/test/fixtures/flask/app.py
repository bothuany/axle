from flask import Flask, Blueprint
bp = Blueprint("items", __name__, url_prefix="/items")

@bp.route("/<int:i>", methods=["GET", "DELETE"])
def item(i):
    return fetch(i)

def fetch(i):
    return i

app = Flask(__name__)
app.register_blueprint(bp)
