import { Controller, Get, Post, Body } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserDto } from './user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(): Promise<UserDto[]> {
    return this.users.findAll();
  }

  @Post()
  create(@Body() body: UserDto): Promise<UserDto> {
    return Promise.resolve(body);
  }
}
