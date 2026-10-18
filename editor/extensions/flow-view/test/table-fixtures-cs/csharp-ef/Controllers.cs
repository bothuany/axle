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
