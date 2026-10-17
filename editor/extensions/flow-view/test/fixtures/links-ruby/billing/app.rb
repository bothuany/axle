post '/api/invoices' do
  save_invoice
end

get '/api/invoices/:id' do
  load_invoice
end
