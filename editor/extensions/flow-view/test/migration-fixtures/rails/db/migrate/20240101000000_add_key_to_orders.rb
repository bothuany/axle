class AddKeyToOrders < ActiveRecord::Migration[7.1]
  def change
    add_column :orders, :key, :string
    remove_column :orders, :legacy_ref, :string
    rename_column :orders, :status, :state
    create_table :order_notes do |t|
      t.string :body
      t.references :order
      t.timestamps
    end
    add_index :orders, :key
    drop_table :tmp_orders
  end
end
