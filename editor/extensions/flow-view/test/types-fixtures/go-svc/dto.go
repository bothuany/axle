package svc

type Address struct {
	Street string "json:\"street\""
	City   string "json:\"city\""
}

type UserResponse struct {
	ID      int                "json:\"id\""
	Addr    *Address           "json:\"addr\""
	Tags    []string           "json:\"tags\""
	Friends []UserResponse     "json:\"friends\""
	ByName  map[string]Address "json:\"byName\""
}

type UserService struct {
	repo string
}

func (s *UserService) Find(id int) *UserResponse {
	return nil
}
