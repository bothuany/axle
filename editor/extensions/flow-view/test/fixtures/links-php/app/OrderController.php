<?php
use Illuminate\Support\Facades\Http;
class OrderController {
    public function __construct(private \GuzzleHttp\Client $client) {}
    public function store() { return Http::withToken('t')->post(config('svc.billing') . '/api/invoices', []); }
    // Guzzle with options: a path and a second argument, like a route registration.
    public function show($id) { return $this->client->get("/api/invoices/$id", ['headers' => []]); }
}
