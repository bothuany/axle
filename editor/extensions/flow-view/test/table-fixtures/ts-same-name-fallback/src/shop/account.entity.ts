import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('shop_accounts')
export class Account {
  @PrimaryGeneratedColumn()
  id: number;
}
