class StripeGateway:
    def charge_card(self, n):
        return audit(n)
    def refund_money(self, n):
        return n
def audit(n):
    return n
