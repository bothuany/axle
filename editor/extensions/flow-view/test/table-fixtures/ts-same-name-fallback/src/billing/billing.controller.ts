import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// Account is not imported here: the same folder is all that says which one it is.
@Controller('billing')
export class BillingController {
  constructor(@InjectRepository(Account) private readonly repo: Repository<Account>) {}

  @Get()
  list() {
    return this.repo.find();
  }
}
