using Microsoft.EntityFrameworkCore;

namespace Shop;

public class ShopDb : DbContext
{
    public DbSet<Order> Orders { get; set; } = new();
    public DbSet<Customer> Customers { get; set; } = new();
    public DbSet<Shipment> Shipments { get; set; } = new();
    public DbSet<Warehouse> Warehouses { get; set; } = new();
    public DbSet<Supplier> Suppliers { get; set; } = new();
    public DbSet<Account> Accounts { get; set; } = new();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Warehouse>().ToTable("warehouses").HasKey(w => w.Id);
        modelBuilder.Entity<Supplier>(b =>
        {
            b.ToTable("suppliers");
            b.Property(s => s.Name).HasColumnName("supplier_name");
        });
        modelBuilder.Entity<Account>().ToTable("shop_accounts");
    }
}
