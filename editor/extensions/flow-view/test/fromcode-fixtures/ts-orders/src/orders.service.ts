import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from './order.entity';

@Injectable()
export class OrdersService {
  constructor(@InjectRepository(Order) private readonly repo: Repository<Order>) {}

  pay(order: Order) {
    if (order.status === OrderStatus.New) {
      order.status = OrderStatus.Paid;
      return this.repo.save(order);
    }
  }

  ship(order: Order) {
    if (order.status === OrderStatus.Paid) {
      order.status = OrderStatus.Shipped;
      return this.repo.save(order);
    }
  }

  reset(order: Order) {
    order.status = OrderStatus.New;
  }
}
