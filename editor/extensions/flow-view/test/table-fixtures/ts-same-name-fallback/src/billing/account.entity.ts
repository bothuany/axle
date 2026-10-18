import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('billing_accounts')
export class Account {
  @PrimaryGeneratedColumn()
  id: number;
}
