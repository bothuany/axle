using System.Collections.Generic;

namespace Microsoft.EntityFrameworkCore
{
    public class DbSet<T> : List<T> where T : class { }

    public class DbContext
    {
        public DbSet<T> Set<T>() where T : class => new DbSet<T>();
        protected virtual void OnModelCreating(ModelBuilder modelBuilder) { }
    }

    public class ModelBuilder
    {
        public EntityTypeBuilder<T> Entity<T>() where T : class => new EntityTypeBuilder<T>();
        public ModelBuilder Entity<T>(Action<EntityTypeBuilder<T>> configure) where T : class => this;
    }

    public class PropertyBuilder
    {
        public PropertyBuilder HasColumnName(string name) => this;
    }

    public class EntityTypeBuilder<T> where T : class
    {
        public EntityTypeBuilder<T> ToTable(string name) => this;
        public EntityTypeBuilder<T> HasKey(System.Linq.Expressions.Expression<Func<T, object?>> key) => this;
        public PropertyBuilder Property(System.Linq.Expressions.Expression<Func<T, object?>> property) => new PropertyBuilder();
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
