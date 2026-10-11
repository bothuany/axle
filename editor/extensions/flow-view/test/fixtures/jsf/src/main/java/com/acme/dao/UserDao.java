package com.acme.dao;
import javax.persistence.EntityManager;
import javax.persistence.PersistenceContext;
public class UserDao {
    @PersistenceContext private EntityManager em;
    public void insert(String n) { em.persist(n); }
    public void remove(Object u) { em.remove(u); }
}
