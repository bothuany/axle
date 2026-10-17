post '/orders' do
  HTTParty.post("#{BILLING}/api/invoices", body: params)
end

# Faraday with a block reads like a Sinatra route; it must stay a request.
get '/orders/:id' do
  @conn.get("/api/invoices/#{params[:id]}") do |req|
    req.headers['Accept'] = 'application/json'
  end
end
