import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// Account is not imported and nothing of this folder is an Account.
@Controller('api')
export class ApiController {
  constructor(@InjectRepository(Account) private readonly repo: Repository<Account>) {}

  @Get()
  list() {
    return this.repo.find();
  }
}
