/* MySQL and SQL Server flavours in one file. */
ALTER TABLE `customers` ADD COLUMN `vip` TINYINT(1), ADD INDEX `ix_vip` (`vip`);
ALTER TABLE `customers` CHANGE COLUMN `mail` `email` VARCHAR(120);
ALTER TABLE `customers` MODIFY COLUMN `name` VARCHAR(200);
RENAME TABLE `customers` TO `clients`;
ALTER TABLE [dbo].[Invoices] ADD [Total] decimal(18,2) NULL;
ALTER TABLE [dbo].[Invoices] DROP COLUMN [Legacy];
ALTER TABLE invoices ADD CONSTRAINT fk_inv FOREIGN KEY (customer_id) REFERENCES clients (id);
EXEC sp_rename 'dbo.Invoices.Total', 'Amount', 'COLUMN';
CREATE FUNCTION touch() RETURNS trigger AS $$ BEGIN ALTER TABLE ignored_in_body ADD COLUMN x int; RETURN NEW; END $$ LANGUAGE plpgsql;
