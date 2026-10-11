from rest_framework.views import APIView
from .models import Product

class ProductList(APIView):
    def get(self, request):
        return Product.objects.all()
    def post(self, request):
        return Product.objects.create()
