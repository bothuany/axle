class UserService
  def all
    UserRepo.new.fetch
  end
end
class UserRepo
  def fetch
    []
  end
end
def greet
  audit
end
def audit
  1
end
class HealthController < ApplicationController
  def show
    UserService.new.all
  end
end
