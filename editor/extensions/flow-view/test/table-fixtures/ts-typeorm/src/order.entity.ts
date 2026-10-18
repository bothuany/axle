import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'customer_email', length: 120 })
  customerEmail: string;

  @Column({ nullable: true })
  status: string;
}
