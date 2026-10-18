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

// Configured in ShopDb.OnModelCreating, in a chain: modelBuilder.Entity<Warehouse>().ToTable("warehouses").
public class Warehouse
{
    public int Id { get; set; }
    public string City { get; set; } = "";
}

// Configured in ShopDb.OnModelCreating with a lambda: modelBuilder.Entity<Supplier>(b => { ... }).
public class Supplier
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
}

// Shop and Billing both have an Account: the DbSet's declared type says which one a query reaches.
public class Account
{
    public int Id { get; set; }
}
