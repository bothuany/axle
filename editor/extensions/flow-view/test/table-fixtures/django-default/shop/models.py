from django.db import models


# No Meta.db_table: the table is shop_product by Django's naming rule, which the folder name only suggests.
class Product(models.Model):
    name = models.CharField(max_length=100)
    price = models.IntegerField()
