using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations.Schema;

namespace Billing;

[Table("billing_accounts")]
public class Account
{
    public int Id { get; set; }
}

public class BillingDb : DbContext
{
    public DbSet<Account> Accounts { get; set; } = new();
}

public class BillingAccountsController : ControllerBase
{
    private readonly BillingDb _db;

    public BillingAccountsController(BillingDb db) => _db = db;

    [HttpPost]
    public Account Create(Account account)
    {
        _db.Accounts.Add(account);
        return account;
    }
}
