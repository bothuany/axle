<?php
use App\Http\Controllers\UserController;
Route::get('/users', [UserController::class, 'index']);
Route::post('/users', 'UserController@store');
Route::get('/ping', function () { return ping(); });
class UserController {
    public function __construct(private UserService $service) {}
    public function index() { return $this->service->all(); }
    #[Route('/sym', methods: ['GET'])]
    public function sym() { return helper(); }
}
