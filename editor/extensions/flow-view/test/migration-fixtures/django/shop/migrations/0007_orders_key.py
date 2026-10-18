from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("shop", "0006_auto")]

    operations = [
        migrations.AddField(model_name="order", name="key", field=models.CharField(max_length=40, null=True)),
        migrations.RemoveField(model_name="order", name="legacy_ref"),
        migrations.RenameField(model_name="order", old_name="status", new_name="state"),
        migrations.AlterField(model_name="order", name="total", field=models.IntegerField()),
        migrations.CreateModel(
            name="Note",
            fields=[("id", models.AutoField(primary_key=True)), ("body", models.TextField())],
            options={"db_table": "order_notes"},
        ),
        migrations.CreateModel(name="Tag", fields=[("id", models.AutoField(primary_key=True)), ("label", models.CharField(max_length=20))]),
        migrations.AddIndex(model_name="order", index=models.Index(fields=["key"], name="ix_key")),
        migrations.DeleteModel(name="Legacy"),
        migrations.RunPython(lambda apps, schema: None),
    ]
