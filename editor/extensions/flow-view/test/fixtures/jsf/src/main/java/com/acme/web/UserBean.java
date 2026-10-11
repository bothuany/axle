package com.acme.web;
import javax.faces.bean.ManagedBean;
import javax.faces.bean.ViewScoped;
import javax.inject.Inject;
import com.acme.service.UserService;
@ManagedBean(name = "userBean")
@ViewScoped
public class UserBean {
    @Inject private UserService userService;
    private String name;
    public String save() { userService.create(name); return "list"; }
    public void remove(Object u) { userService.delete(u); }
    public String getName() { return name; }
}
