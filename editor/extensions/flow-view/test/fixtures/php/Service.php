<?php
class UserService {
    public function all() { return $this->repo->fetch(); }
}
class UserRepo { public function fetch() { return []; } }
function helper() { return audit(); }
function ping() { return 'pong'; }
function audit() { return 1; }
