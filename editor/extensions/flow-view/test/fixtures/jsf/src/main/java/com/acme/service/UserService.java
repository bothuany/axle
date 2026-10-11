package com.acme.service;
import javax.ejb.Stateless;
import javax.inject.Inject;
import com.acme.dao.UserDao;
@Stateless
public class UserService {
    @Inject private UserDao dao;
    public void create(String n) { dao.insert(n); }
    public void delete(Object u) { dao.remove(u); }
}
