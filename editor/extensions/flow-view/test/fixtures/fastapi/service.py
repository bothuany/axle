class UserService:
    def find(self, id):
        return self.load(id)
    def load(self, id):
        return {"id": id}
    def create(self, body):
        return body
