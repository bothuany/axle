using Microsoft.EntityFrameworkCore;

namespace Shop;

public class ShopDb : DbContext
{
    public DbSet<Order> Orders { get; set; } = new();
    public DbSet<Customer> Customers { get; set; } = new();
    public DbSet<Shipment> Shipments { get; set; } = new();
}
