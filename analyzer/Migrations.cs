using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace FlowAnalyzer;

/// <summary>One thing an EF Core migration does to a table (the shape editor/extensions/flow-view/src/poly/migrations.ts calls EfFact.ops).</summary>
public sealed record MigrationOpFact(string Table, string Op, List<string> Columns, string? To, int Line);

/// <summary>Raw SQL in <c>migrationBuilder.Sql("...")</c>: the editor's DDL reader makes sense of it.</summary>
public sealed record MigrationSql(string Text, int Line);

public sealed record MigrationFact(string Name, List<MigrationOpFact> Ops, List<MigrationSql> Sql, List<string> Notes);

/// <summary>
/// Reads an EF Core migration: the calls <c>Up(MigrationBuilder migrationBuilder)</c> makes on the builder (CreateTable, AddColumn,
/// DropColumn, RenameColumn, ...), from the syntax of the one file. It needs no solution, only the file; the rollback (<c>Down</c>) is not read.
/// </summary>
public static class MigrationReader
{
    public static MigrationFact? Read(string file)
    {
        var tree = CSharpSyntaxTree.ParseText(File.ReadAllText(file));
        var up = tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>()
            .FirstOrDefault(m => m.Identifier.Text == "Up" && m.ParameterList.Parameters.Any(p => p.Type?.ToString().EndsWith("MigrationBuilder") == true));
        if (up == null) return null;
        var builder = up.ParameterList.Parameters.First(p => p.Type?.ToString().EndsWith("MigrationBuilder") == true).Identifier.Text;
        var ops = new List<MigrationOpFact>();
        var sql = new List<MigrationSql>();
        var notes = new List<string>();

        foreach (var inv in up.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax { Expression: IdentifierNameSyntax id } ma || id.Identifier.Text != builder) continue;
            var name = ma.Name is GenericNameSyntax g ? g.Identifier.Text : ma.Name.Identifier.Text;
            var line = inv.GetLocation().GetLineSpan().StartLinePosition.Line + 1;

            if (name == "Sql")
            {
                if (Str(Arg(inv, "sql", 0)) is { } text) sql.Add(new MigrationSql(text, line));
                else notes.Add($"line {line}: Sql(...) is not a string literal");
                continue;
            }

            var table = name switch
            {
                "CreateTable" or "DropTable" or "RenameTable" => Str(Arg(inv, "name", 0)),
                _ => Str(Arg(inv, "table", 1)),
            };
            if (table == null)
            {
                if (name is "CreateTable" or "DropTable" or "RenameTable" or "AddColumn" or "DropColumn" or "RenameColumn" or "AlterColumn" or "CreateIndex" or "DropIndex" or "AddForeignKey" or "DropForeignKey" or "AddPrimaryKey" or "DropPrimaryKey" or "AddUniqueConstraint" or "DropUniqueConstraint" or "AddCheckConstraint" or "DropCheckConstraint")
                    notes.Add($"line {line}: {name} on a table name that is not a string literal");
                continue;
            }
            var column = Str(Arg(inv, "name", 0));
            switch (name)
            {
                case "CreateTable":
                    ops.Add(new MigrationOpFact(table, "create", CreateColumns(Arg(inv, "columns", 2)), null, line));
                    break;
                case "DropTable":
                    ops.Add(new MigrationOpFact(table, "drop", new(), null, line));
                    break;
                case "RenameTable":
                    // RenameTable(name, schema, newName, newSchema): position 1 is the schema, so RenameTable("Orders", "dbo") moves a
                    // table to another schema and renames nothing.
                    ops.Add(new MigrationOpFact(table, "rename", new(), Str(Arg(inv, "newName", 2)), line));
                    break;
                case "AddColumn":
                    ops.Add(new MigrationOpFact(table, "alter-add", Some(column), null, line));
                    break;
                case "DropColumn":
                    ops.Add(new MigrationOpFact(table, "alter-drop", Some(column), null, line));
                    break;
                case "RenameColumn":
                    ops.Add(new MigrationOpFact(table, "rename", column != null && Str(Arg(inv, "newName", 2)) is { } to ? new() { $"{column} → {to}" } : new(), null, line));
                    break;
                case "AlterColumn":
                    ops.Add(new MigrationOpFact(table, "alter", Some(column), null, line));
                    break;
                case "CreateIndex":
                    ops.Add(new MigrationOpFact(table, "index", IndexColumns(inv), null, line));
                    break;
                case "DropIndex":
                    // DropIndex(name, table, schema): no columns, and position 2 is the schema.
                    ops.Add(new MigrationOpFact(table, "index", new(), null, line));
                    break;
                case "AddForeignKey":
                case "DropForeignKey":
                case "AddPrimaryKey":
                case "DropPrimaryKey":
                case "AddUniqueConstraint":
                case "DropUniqueConstraint":
                case "AddCheckConstraint":
                case "DropCheckConstraint":
                    ops.Add(new MigrationOpFact(table, "alter", new(), null, line));
                    break;
            }
        }
        return new MigrationFact(Path.GetFileNameWithoutExtension(file), ops, sql, notes);
    }

    private static List<string> Some(string? name) => name == null ? new() : new() { name };

    /// <summary>The argument called <paramref name="name"/>, else the one at <paramref name="position"/> when it is not named.</summary>
    private static ExpressionSyntax? Arg(InvocationExpressionSyntax inv, string name, int position)
    {
        var named = inv.ArgumentList.Arguments.FirstOrDefault(a => a.NameColon?.Name.Identifier.Text == name);
        if (named != null) return named.Expression;
        var args = inv.ArgumentList.Arguments;
        return position < args.Count && args[position].NameColon == null ? args[position].Expression : null;
    }

    private static string? Str(ExpressionSyntax? e) =>
        e is LiteralExpressionSyntax { RawKind: (int)SyntaxKind.StringLiteralExpression } l ? l.Token.ValueText : null;

    /// <summary><c>table => new { Id = table.Column&lt;int&gt;(...), Name = ... }</c>: the member names.</summary>
    private static List<string> CreateColumns(ExpressionSyntax? columns) =>
        ((columns as LambdaExpressionSyntax)?.Body as AnonymousObjectCreationExpressionSyntax)?.Initializers
            .Select(i => i.NameEquals?.Name.Identifier.Text ?? (i.Expression as MemberAccessExpressionSyntax)?.Name.Identifier.Text)
            .OfType<string>().ToList() ?? new();

    /// <summary>
    /// CreateIndex(name, table, column) or CreateIndex(name, table, columns): <c>column: "Key"</c>, <c>columns: new[] { "Key", "CreatedAt" }</c>,
    /// or either one third, unnamed.
    /// </summary>
    private static List<string> IndexColumns(InvocationExpressionSyntax inv)
    {
        if (Str(Arg(inv, "column", 2)) is { } one) return new() { one };
        var many = Arg(inv, "columns", 2);
        var items = many switch
        {
            ArrayCreationExpressionSyntax a => a.Initializer?.Expressions,
            ImplicitArrayCreationExpressionSyntax i => i.Initializer.Expressions,
            _ => null,
        };
        return items?.Select(Str).OfType<string>().ToList() ?? new();
    }
}
