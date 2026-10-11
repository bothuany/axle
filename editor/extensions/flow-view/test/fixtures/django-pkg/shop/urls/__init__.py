from django.urls import path
from .handlers import list_items
from .. import views

urlpatterns = [path("items/", list_items), path("orders/", views.list_orders)]
