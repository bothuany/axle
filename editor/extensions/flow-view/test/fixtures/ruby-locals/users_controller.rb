class UsersController < ApplicationController
  def index
    user = fetch_user
    user
    audit
  end

  def fetch_user
    1
  end

  def audit
    2
  end
end
