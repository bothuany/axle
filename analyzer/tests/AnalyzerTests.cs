using FlowAnalyzer;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Text;
using Xunit;

namespace FlowAnalyzer.Tests;

/// <summary>
/// A solution built in memory from source text: the EF Core and ASP.NET types are stand-ins of the same names (as in
/// editor/extensions/flow-view/test/table-fixtures-cs), so nothing is restored and no MSBuild runs.
/// </summary>
static class Solutions
{
    public const string Stubs = """
        using System;
        using System.Collections.Generic;

        namespace Microsoft.EntityFrameworkCore
        {
            public class DbSet<T> : List<T> where T : class { }
            public class DbContext
            {
                public DbSet<T> Set<T>() where T : class => new DbSet<T>();
            }
        }

        namespace Microsoft.AspNetCore.Mvc
        {
            public class ControllerBase { }
            public class Controller : ControllerBase { }
            [AttributeUsage(AttributeTargets.Method, Inherited = true)] public sealed class HttpGetAttribute : Attribute { }
            [AttributeUsage(AttributeTargets.Method, Inherited = true)] public sealed class HttpPostAttribute : Attribute { }
        }
        """;

    public static Solution Build(params (string Name, string Text)[] files)
    {
        var refs = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!).Split(Path.PathSeparator)
            .Where(p => Path.GetFileName(p) is "System.Runtime.dll" or "System.Private.CoreLib.dll" or "System.Collections.dll" or "System.Linq.dll" or "netstandard.dll")
            .Select(p => MetadataReference.CreateFromFile(p));
        var workspace = new AdhocWorkspace();
        var project = workspace.CurrentSolution.AddProject("Shop", "Shop", LanguageNames.CSharp)
            .WithCompilationOptions(new Microsoft.CodeAnalysis.CSharp.CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary))
            .AddMetadataReferences(refs);
        var root = Path.Combine(Path.GetTempPath(), "flow-analyzer-tests");
        foreach (var (name, text) in files.Prepend(("Stubs.cs", Stubs)))
            project = project.AddDocument(name, SourceText.From(text), filePath: Path.Combine(root, name)).Project;
        return project.Solution;
    }
}

public class SchemaTests
{
    const string Shop = """
        using System.Collections.Generic;
        using System.Linq;
        using Microsoft.AspNetCore.Mvc;
        using Microsoft.EntityFrameworkCore;

        namespace Shop;

        public class Order { public int Id { get; set; } }
        public class Note { public int Id { get; set; } }

        public class ShopDb : DbContext
        {
            public DbSet<Order> Orders { get; set; } = new();
        }

        public class ReportsController : ControllerBase
        {
            private readonly ShopDb _db = new();
            [HttpGet] public List<Order> Open() => _db.Set<Order>().Where(o => o.Id > 0).ToList();
            [HttpGet] public List<Note> Notes() => _db.Set<Note>().ToList();
        }

        public class OrdersController : ControllerBase
        {
            private readonly ShopDb _db = new();
            [HttpGet] public List<Order> List() => _db.Orders.ToList();
        }
        """;

    static async Task<DbSchema> CardOf(FlowGraph graph, string action)
    {
        var entry = (await graph.EntryPointsAsync()).Single(e => $"{e.Controller}.{e.Action}" == action);
        var root = await graph.BuildAsync(entry.Id, 3);
        return root!.Children.Single(c => c.EdgeKind == "db").Node.Schema!;
    }

    [Fact]
    public async Task An_entity_read_through_Set_T_is_named_by_its_DbSet_property_whoever_asks_first()
    {
        // Set<T>() first: before the fix the table was guessed as "Set", and cached for every later caller.
        var graph = new FlowGraph(Solutions.Build(("Shop.cs", Shop)));
        Assert.Equal("Orders", (await CardOf(graph, "ReportsController.Open")).Table);
        Assert.Equal("Orders", (await CardOf(graph, "OrdersController.List")).Table);
        Assert.Equal("Orders", (await graph.EntitiesAsync()).Single(e => e.Entity == "Order").Table);
        Assert.True((await CardOf(graph, "ReportsController.Open")).Guess);
    }

    [Fact]
    public async Task An_entity_with_no_DbSet_property_is_named_by_its_type()
    {
        var graph = new FlowGraph(Solutions.Build(("Shop.cs", Shop)));
        Assert.Equal("Note", (await CardOf(graph, "ReportsController.Notes")).Table);
    }
}

public class EntryPointTests
{
    const string Api = """
        using System.Collections.Generic;
        using Microsoft.AspNetCore.Mvc;

        namespace Api;

        public class Order { }
        public class Customer { }

        public static class Audit { public static void Read(string what) { } }

        public abstract class BaseApiController<T> : ControllerBase where T : class
        {
            [HttpGet] public virtual List<T> List() { Audit.Read(typeof(T).Name); return new(); }
            [HttpPost] public T Create(T item) => item;
            public void Helper() { }
        }

        public class OrdersController : BaseApiController<Order>
        {
            [HttpGet] public Order Get(int id) => new();
        }

        public class CustomersController : BaseApiController<Customer>
        {
            // An override with no attribute of its own is still the GET action (ASP.NET reads the attributes with inheritance).
            public override List<Customer> List() => new();
        }
        """;

    [Fact]
    public async Task Actions_declared_on_a_base_controller_are_entry_points_of_each_controller_that_inherits_them()
    {
        var graph = new FlowGraph(Solutions.Build(("Api.cs", Api)));
        var entries = (await graph.EntryPointsAsync()).Select(e => $"{e.Http} {e.Controller}.{e.Action}").OrderBy(x => x).ToList();
        Assert.Equal(new[] { "GET CustomersController.List", "GET OrdersController.Get", "GET OrdersController.List", "POST CustomersController.Create", "POST OrdersController.Create" }, entries);
        var ids = (await graph.EntryPointsAsync()).ToDictionary(e => $"{e.Controller}.{e.Action}", e => e.Id);
        Assert.Equal(ids["OrdersController.Create"], ids["CustomersController.Create"]);
        Assert.Contains("BaseApiController`1.Create", ids["OrdersController.Create"]);
        Assert.Contains("CustomersController.List", ids["CustomersController.List"]);
        Assert.NotNull(await graph.BuildAsync(ids["OrdersController.List"], 3));
    }

    [Fact]
    public async Task Impact_names_every_controller_that_routes_an_inherited_action()
    {
        var graph = new FlowGraph(Solutions.Build(("Api.cs", Api)));
        var read = (await graph.MethodsAsync(Path.Combine(Path.GetTempPath(), "flow-analyzer-tests", "Api.cs"))).Single(m => m.Name == "Audit.Read");
        Assert.Equal(new[] { "Orders.List" }, await graph.ImpactAsync(read.Id));
        var methods = await graph.MethodsAsync(Path.Combine(Path.GetTempPath(), "flow-analyzer-tests", "Api.cs"));
        Assert.True(methods.Single(m => m.Name == "BaseApiController.List").IsEntry);
        Assert.False(methods.Single(m => m.Name == "BaseApiController.Helper").IsEntry);
        Assert.True(methods.Single(m => m.Name == "CustomersController.List").IsEntry);
    }
}

public class TableWalkTests
{
    const string Shop = """
        using System.Collections.Generic;
        using System.Linq;
        using Microsoft.AspNetCore.Mvc;
        using Microsoft.EntityFrameworkCore;

        namespace Shop;

        public class Order { public int Id { get; set; } }
        public class ShopDb : DbContext { public DbSet<Order> Orders { get; set; } = new(); }

        public class OrdersController : ControllerBase
        {
            private readonly ShopDb _db = new();
            [HttpGet] public List<Order> List() => _db.Orders.ToList();
        }
        """;

    [Fact]
    public async Task A_cancelled_step_leaves_its_entry_point_for_the_next_one()
    {
        var walk = new TableWalk(new FlowGraph(Solutions.Build(("Shop.cs", Shop))));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => walk.StepAsync(new CancellationToken(true)));
        Assert.Equal(0, walk.Snapshot().Checked);
        Assert.False(walk.Snapshot().Done);
        Assert.True(await walk.StepAsync(CancellationToken.None));
        var snapshot = walk.Snapshot();
        Assert.Equal((1, true), (snapshot.Checked, snapshot.Done));
        Assert.Equal("Orders", Assert.Single(snapshot.Uses).Table);
    }

    [Fact]
    public async Task An_entry_point_cancelled_again_and_again_is_given_up_so_the_walk_can_end()
    {
        var walk = new TableWalk(new FlowGraph(Solutions.Build(("Shop.cs", Shop))));
        for (var i = 0; i < 3; i++)
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => walk.StepAsync(new CancellationToken(true)));
        Assert.Equal((1, true), (walk.Snapshot().Checked, walk.Snapshot().Done));
        Assert.Empty(walk.Snapshot().Uses);
    }
}

public class MigrationTests
{
    static MigrationFact Read(string up)
    {
        var file = Path.Combine(Path.GetTempPath(), $"flow-migration-{Guid.NewGuid():N}.cs");
        File.WriteAllText(file, $$"""
            using Microsoft.EntityFrameworkCore.Migrations;
            public partial class M : Migration
            {
                protected override void Up(MigrationBuilder migrationBuilder)
                {
            {{up}}
                }
            }
            """);
        try { return MigrationReader.Read(file)!; }
        finally { File.Delete(file); }
    }

    [Fact]
    public void RenameTable_reads_newName_from_its_own_position_not_the_schema()
    {
        var moved = Read("""migrationBuilder.RenameTable("Orders", "dbo");""").Ops.Single();
        Assert.Equal(("Orders", "rename", (string?)null), (moved.Table, moved.Op, moved.To));
        Assert.Equal("Deliveries", Read("""migrationBuilder.RenameTable("Shipments", null, "Deliveries");""").Ops.Single().To);
        Assert.Equal("Deliveries", Read("""migrationBuilder.RenameTable(name: "Shipments", newName: "Deliveries");""").Ops.Single().To);
    }

    [Fact]
    public void CreateIndex_reads_a_column_given_by_position_and_DropIndex_reads_no_schema_as_a_column()
    {
        Assert.Equal(new[] { "Key" }, Read("""migrationBuilder.CreateIndex("IX_orders_Key", "orders", "Key");""").Ops.Single().Columns);
        Assert.Equal(new[] { "A", "B" }, Read("""migrationBuilder.CreateIndex("IX", "orders", new[] { "A", "B" });""").Ops.Single().Columns);
        Assert.Equal(new[] { "Key" }, Read("""migrationBuilder.CreateIndex(name: "IX", table: "orders", column: "Key");""").Ops.Single().Columns);
        Assert.Empty(Read("""migrationBuilder.DropIndex("IX", "orders", "dbo");""").Ops.Single().Columns);
    }

    [Fact]
    public void A_check_constraint_on_a_table_that_is_not_a_string_literal_is_noted()
    {
        var fact = Read("""
            var t = "orders";
            migrationBuilder.AddCheckConstraint("CK_total", t, "Total > 0");
            """);
        Assert.Empty(fact.Ops);
        Assert.Contains(fact.Notes, n => n.Contains("AddCheckConstraint on a table name that is not a string literal"));
    }
}

public class AssistTests
{
    [Fact]
    public async Task Default_values_are_written_as_CSharp_whatever_the_culture()
    {
        var solution = Solutions.Build(("Api.cs", """
            namespace Api;
            public enum Color { Red = 0, Blue = 1 }
            public static class Tools { public static void F(double x = 0.5, char c = 'a', Color k = Color.Blue, string s = "q", int? n = null, Color z = default) { } }
            """));
        var compilation = (await solution.Projects.Single().GetCompilationAsync())!;
        var f = compilation.GetTypeByMetadataName("Api.Tools")!.GetMembers("F").OfType<IMethodSymbol>().Single();
        var culture = System.Globalization.CultureInfo.CurrentCulture;
        System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("tr-TR");
        try
        {
            Assert.Equal(new[] { "0.5", "'a'", "Color.Blue", "\"q\"", "null", "Color.Red" }, f.Parameters.Select(Assist.DefaultValueText).ToArray());
        }
        finally { System.Globalization.CultureInfo.CurrentCulture = culture; }
    }
}
