Rails.application.routes.draw do
  get '/health', to: 'health#show'
  resources :users
end
class UsersController < ApplicationController
  def index
    @users = UserService.new.all
  end
end
get '/hello' do
  greet
end
