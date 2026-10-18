using System.Collections.Generic;

namespace Microsoft.EntityFrameworkCore
{
    public class DbSet<T> : List<T> where T : class { }

    public class DbContext
    {
        public DbSet<T> Set<T>() where T : class => new DbSet<T>();
    }

    public class EntityTypeBuilder<T> where T : class
    {
        public EntityTypeBuilder<T> ToTable(string name) => this;
    }

    public interface IEntityTypeConfiguration<T> where T : class
    {
        void Configure(EntityTypeBuilder<T> builder);
    }
}

namespace System.ComponentModel.DataAnnotations.Schema
{
    [AttributeUsage(AttributeTargets.Class)]
    public sealed class TableAttribute : Attribute
    {
        public TableAttribute(string name) { }
    }
}

namespace Microsoft.AspNetCore.Mvc
{
    public class ControllerBase { }

    [AttributeUsage(AttributeTargets.Method)]
    public sealed class HttpGetAttribute : Attribute { }

    [AttributeUsage(AttributeTargets.Method)]
    public sealed class HttpPostAttribute : Attribute { }
}
