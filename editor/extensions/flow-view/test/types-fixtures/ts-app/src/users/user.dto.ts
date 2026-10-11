export enum Role {
  Admin = 'admin',
  Member = 'member',
}

export type AddressDto = {
  street: string;
  city: string;
};

export interface UserDto {
  id: number;
  name: string;
  address?: AddressDto;
  tags: string[];
  roles: Role[];
  manager: UserDto | null;
}
