using Microsoft.AspNetCore.Mvc;

namespace Shop;

public class OrdersController : ControllerBase
{
    private readonly ShopDb _db;

    public OrdersController(ShopDb db) => _db = db;

    [HttpPost]
    public Order Create(Order order)
    {
        _db.Orders.Add(order);
        return order;
    }

    [HttpGet]
    public List<Order> List()
    {
        return _db.Orders.Where(o => o.Status == "open").ToList();
    }
}

public class CustomersController : ControllerBase
{
    private readonly ShopDb _db;

    public CustomersController(ShopDb db) => _db = db;

    [HttpGet]
    public List<Customer> List()
    {
        return _db.Customers.ToList();
    }
}

public class ShipmentsController : ControllerBase
{
    private readonly ShopDb _db;

    public ShipmentsController(ShopDb db) => _db = db;

    [HttpGet]
    public List<Shipment> List()
    {
        return _db.Shipments.ToList();
    }
}

public class WarehousesController : ControllerBase
{
    private readonly ShopDb _db;

    public WarehousesController(ShopDb db) => _db = db;

    [HttpGet]
    public List<Warehouse> List()
    {
        return _db.Warehouses.ToList();
    }
}

public class SuppliersController : ControllerBase
{
    private readonly ShopDb _db;

    public SuppliersController(ShopDb db) => _db = db;

    [HttpPost]
    public Supplier Create(Supplier supplier)
    {
        _db.Suppliers.Add(supplier);
        return supplier;
    }
}

public class ShopAccountsController : ControllerBase
{
    private readonly ShopDb _db;

    public ShopAccountsController(ShopDb db) => _db = db;

    [HttpGet]
    public List<Account> List()
    {
        return _db.Accounts.ToList();
    }
}
