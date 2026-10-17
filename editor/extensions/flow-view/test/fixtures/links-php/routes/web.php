<?php
use App\Http\Controllers\InvoiceController;
use App\Http\Controllers\OrderController;
Route::post('/api/invoices', [InvoiceController::class, 'store']);
Route::get('/api/invoices/{id}', [InvoiceController::class, 'show']);
Route::post('/orders', [OrderController::class, 'store']);
Route::get('/orders/{id}', [OrderController::class, 'show']);
