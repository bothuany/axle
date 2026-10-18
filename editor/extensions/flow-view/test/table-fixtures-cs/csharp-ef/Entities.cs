using System.ComponentModel.DataAnnotations.Schema;

namespace Shop;

// The table is written on the class.
[Table("orders")]
public class Order
{
    public int Id { get; set; }
    public string Status { get; set; } = "";
}

// The table is written in its IEntityTypeConfiguration (CustomerConfiguration.cs).
public class Customer
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
}

// Nothing names the table: EF falls back to the DbSet property's name, which the code does not write.
public class Shipment
{
    public int Id { get; set; }
    public int OrderId { get; set; }
}
