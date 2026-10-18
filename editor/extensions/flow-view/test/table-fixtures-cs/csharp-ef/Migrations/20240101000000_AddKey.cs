using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Migrations
{
    /// <inheritdoc />
    public partial class AddKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Key",
                table: "orders",
                type: "nvarchar(40)",
                nullable: true);

            migrationBuilder.DropColumn(
                name: "LegacyRef",
                table: "orders");

            migrationBuilder.RenameColumn(
                name: "Status",
                table: "orders",
                newName: "State");

            migrationBuilder.AlterColumn<decimal>(
                name: "Total",
                table: "orders",
                nullable: false);

            migrationBuilder.CreateTable(
                name: "OrderNotes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false),
                    Body = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderNotes", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_orders_Key",
                table: "orders",
                columns: new[] { "Key", "CreatedAt" });

            migrationBuilder.RenameTable(
                name: "Shipments",
                newName: "Deliveries");

            migrationBuilder.Sql("ALTER TABLE customers ADD vip bit NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Key",
                table: "orders");
        }
    }
}
