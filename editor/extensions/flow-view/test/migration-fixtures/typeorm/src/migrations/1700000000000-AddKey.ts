import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

export class AddKey1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn('orders', new TableColumn({ name: 'key', type: 'varchar', isNullable: true }));
    await queryRunner.dropColumn('orders', 'legacy_ref');
    await queryRunner.renameColumn('orders', 'status', 'state');
    await queryRunner.createTable(new Table({
      name: 'order_notes',
      columns: [{ name: 'id', type: 'int', isPrimary: true }, { name: 'body', type: 'text' }],
    }));
    await queryRunner.createIndex('orders', new TableIndex({ name: 'ix_key', columnNames: ['key'] }));
    await queryRunner.query(`ALTER TABLE "customers" ADD "vip" boolean`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('orders', 'key');
  }
}
