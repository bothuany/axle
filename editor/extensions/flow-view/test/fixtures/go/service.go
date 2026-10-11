package main

type UserService struct{ repo *UserRepo }

func (s *UserService) FindAll() []string { return s.repo.Query() }

type UserRepo struct{}

func (r *UserRepo) Query() []string { return nil }

func notify() { audit() }
func audit()  {}
func legacy(w http.ResponseWriter, r *http.Request) { notify() }
