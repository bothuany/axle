import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from './account.entity';

@Controller('shop')
export class ShopController {
  constructor(@InjectRepository(Account) private readonly repo: Repository<Account>) {}

  @Get()
  list() {
    return this.repo.find();
  }
}
