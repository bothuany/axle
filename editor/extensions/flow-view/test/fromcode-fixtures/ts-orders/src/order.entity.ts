import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

export enum OrderStatus {
  New = 'new',
  Paid = 'paid',
  Shipped = 'shipped',
}

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @OneToMany(() => Order, order => order.customer)
  orders: Order[];
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Customer, customer => customer.orders)
  customer: Customer;

  @Column({ nullable: true })
  status: OrderStatus;
}
